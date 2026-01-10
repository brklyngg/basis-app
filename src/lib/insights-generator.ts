import Anthropic from "@anthropic-ai/sdk";
import type {
  FinancialMetrics,
  TrendMetrics,
  CategoryBreakdownResult,
  BalanceSheet,
  InsightItem,
  InsightType,
} from "@/types";

/**
 * Input data for generating insights
 */
export interface InsightGeneratorInput {
  coreMetrics: FinancialMetrics;
  trendMetrics: TrendMetrics;
  categoryBreakdown: CategoryBreakdownResult;
  balanceSheet: BalanceSheet;
}

/**
 * Build a financial summary string for Claude to analyze
 */
function buildFinancialSummary(input: InsightGeneratorInput): string {
  const { coreMetrics, trendMetrics, categoryBreakdown, balanceSheet } = input;

  // Format currency for readability
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Format percentage
  const formatPercent = (value: number): string => {
    return `${value.toFixed(1)}%`;
  };

  // Build category spending summary
  const topCategoriesSummary = categoryBreakdown.topCategories
    .map(
      (cat) =>
        `  - ${cat.category}: ${formatCurrency(cat.totalSpend)} (${formatPercent(cat.percentOfExpenses)} of expenses, ${cat.momChange.percentageChange > 0 ? "+" : ""}${formatPercent(cat.momChange.percentageChange)} MoM)`
    )
    .join("\n");

  return `
=== FINANCIAL SUMMARY ===

PERIOD: ${coreMetrics.dateRange.start} to ${coreMetrics.dateRange.end} (${coreMetrics.periodMonths} months)

INCOME & EXPENSES:
- Total Income: ${formatCurrency(coreMetrics.totalIncome)}
- Total Expenses: ${formatCurrency(coreMetrics.totalExpenses)}
- Net Cash Flow: ${formatCurrency(coreMetrics.netCashFlow)}
- Monthly Avg Income: ${formatCurrency(coreMetrics.avgMonthlyIncome)}
- Monthly Avg Expenses: ${formatCurrency(coreMetrics.avgMonthlyExpenses)}

KEY RATIOS:
- Savings Rate: ${formatPercent(coreMetrics.savingsRate)}
- Essential Expenses: ${formatPercent((categoryBreakdown.topCategories.filter(c => ["Housing", "Utilities", "Transportation", "Groceries", "Insurance", "Medical"].includes(c.category)).reduce((sum, c) => sum + c.percentOfIncome, 0)))} of income
- Discretionary Expenses: ${formatPercent((categoryBreakdown.topCategories.filter(c => ["Dining Out", "Entertainment", "Shopping", "Travel", "Subscriptions"].includes(c.category)).reduce((sum, c) => sum + c.percentOfIncome, 0)))} of income

TREND ANALYSIS:
- Trend Direction: ${trendMetrics.trendDirection}
- Month-over-Month Change: ${formatCurrency(trendMetrics.momChange.amount)} (${trendMetrics.momChange.percentageChange > 0 ? "+" : ""}${formatPercent(trendMetrics.momChange.percentageChange)})
- 3-Month Moving Average: ${formatCurrency(trendMetrics.threeMonthMovingAverage)}

TOP SPENDING CATEGORIES:
${topCategoriesSummary}

BALANCE SHEET:
- Liquid Assets: ${formatCurrency(balanceSheet.assets.totalAssets)}
- Credit Card Debt: ${formatCurrency(balanceSheet.liabilities.totalLiabilities)}
- Net Worth: ${formatCurrency(balanceSheet.netWorth)}
`;
}

/**
 * System prompt for generating financial insights
 */
const INSIGHTS_SYSTEM_PROMPT = `You are a friendly, supportive financial coach generating personalized insights for someone reviewing their finances in a spreadsheet.

Your task is to generate exactly 5 insights based on the financial data provided. Each insight should be:
- Written for finance beginners (no jargon)
- Non-judgmental and encouraging
- Specific with actual numbers from the data
- Actionable when appropriate
- 1-2 sentences each

The 5 insights must cover these categories IN ORDER:
1. HEALTH_ASSESSMENT: Overall financial health assessment (is the person in good shape, needs work, etc.)
2. TREND_OBSERVATION: Comment on their financial trajectory (improving, stable, declining)
3. TOP_SPENDING: Observation about their biggest spending category
4. SAVINGS_OBSERVATION: Comment on their savings rate relative to common benchmarks (20% is a good target)
5. POSITIVE_WIN: Find something genuinely positive to celebrate (even small wins count)

Respond in JSON format with an array of 5 objects. Each object has:
- "type": one of "positive", "neutral", or "attention"
  - "positive": something good, a win, or encouraging news
  - "neutral": informational observation, neither good nor bad
  - "attention": something that might need attention or improvement (never negative or harsh)
- "text": the insight text (1-2 sentences, include specific numbers)

Example response format:
[
  {"type": "positive", "text": "Your finances are in solid shape! You're saving $850/month on average, which puts you ahead of most Americans."},
  {"type": "neutral", "text": "Your spending has been pretty consistent over the past 3 months, with only minor fluctuations."},
  {"type": "attention", "text": "Dining out is your biggest expense at $620/month - this might be an area to watch if you want to save more."},
  {"type": "neutral", "text": "At 18% savings rate, you're close to the recommended 20% target. Just a small adjustment could get you there."},
  {"type": "positive", "text": "Great news - you have $12,500 in liquid savings, giving you about 3 months of emergency runway!"}
]`;

/**
 * Generate financial insights using Claude AI
 *
 * Analyzes the user's financial metrics and generates 4-6 personalized insights
 * covering health assessment, trends, top spending, savings rate, and positive wins.
 */
export async function generateFinancialInsights(
  input: InsightGeneratorInput
): Promise<InsightItem[]> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const financialSummary = buildFinancialSummary(input);

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: INSIGHTS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Please analyze this financial data and generate 5 insights:\n${financialSummary}`,
        },
      ],
    });

    // Extract text from response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      console.error("No text content in Claude response");
      return getDefaultInsights(input);
    }

    // Parse JSON response
    try {
      const insights = JSON.parse(textContent.text) as Array<{
        type: string;
        text: string;
      }>;

      // Validate and transform response
      const validInsights: InsightItem[] = insights
        .filter(
          (item) =>
            item &&
            typeof item.type === "string" &&
            typeof item.text === "string"
        )
        .map((item) => ({
          type: validateInsightType(item.type),
          text: item.text,
        }))
        .slice(0, 6); // Limit to 6 insights max

      if (validInsights.length >= 4) {
        return validInsights;
      }

      // Fall back to defaults if we didn't get enough valid insights
      console.warn("Insufficient valid insights from Claude, using defaults");
      return getDefaultInsights(input);
    } catch (parseError) {
      console.error("Failed to parse Claude response as JSON:", parseError);
      return getDefaultInsights(input);
    }
  } catch (error) {
    console.error("Error calling Claude API for insights:", error);
    return getDefaultInsights(input);
  }
}

/**
 * Validate and normalize insight type
 */
function validateInsightType(type: string): InsightType {
  const normalizedType = type.toLowerCase();
  if (normalizedType === "positive") return "positive";
  if (normalizedType === "attention") return "attention";
  return "neutral";
}

/**
 * Generate default insights when Claude API fails
 */
function getDefaultInsights(input: InsightGeneratorInput): InsightItem[] {
  const { coreMetrics, trendMetrics, categoryBreakdown, balanceSheet } = input;

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const insights: InsightItem[] = [];

  // Health assessment based on savings rate
  if (coreMetrics.savingsRate >= 20) {
    insights.push({
      type: "positive",
      text: `You're in great financial shape with a ${coreMetrics.savingsRate.toFixed(1)}% savings rate - that's at or above the recommended 20% target!`,
    });
  } else if (coreMetrics.savingsRate >= 10) {
    insights.push({
      type: "neutral",
      text: `Your ${coreMetrics.savingsRate.toFixed(1)}% savings rate shows you're building a foundation. The common target is 20%, and you're making progress.`,
    });
  } else if (coreMetrics.savingsRate > 0) {
    insights.push({
      type: "attention",
      text: `Your savings rate of ${coreMetrics.savingsRate.toFixed(1)}% suggests there might be room to save more. Even small increases can add up over time.`,
    });
  } else {
    insights.push({
      type: "attention",
      text: `Your expenses are currently exceeding your income. This is worth looking at to find ways to close the gap.`,
    });
  }

  // Trend observation
  if (trendMetrics.trendDirection === "improving") {
    insights.push({
      type: "positive",
      text: `Your finances are trending in the right direction - net cash flow improved by ${formatCurrency(Math.abs(trendMetrics.momChange.amount))} from last month.`,
    });
  } else if (trendMetrics.trendDirection === "declining") {
    insights.push({
      type: "attention",
      text: `Your net cash flow decreased by ${formatCurrency(Math.abs(trendMetrics.momChange.amount))} compared to last month. It's worth keeping an eye on this.`,
    });
  } else {
    insights.push({
      type: "neutral",
      text: `Your finances have been stable recently, with consistent income and spending patterns.`,
    });
  }

  // Top spending category
  if (categoryBreakdown.topCategories.length > 0) {
    const topCat = categoryBreakdown.topCategories[0];
    insights.push({
      type: "neutral",
      text: `${topCat.category} is your biggest expense at ${formatCurrency(topCat.totalSpend)} (${topCat.percentOfExpenses.toFixed(1)}% of spending).`,
    });
  }

  // Savings rate comparison
  const savingsTarget = 20;
  const savingsDiff = coreMetrics.savingsRate - savingsTarget;
  if (savingsDiff >= 0) {
    insights.push({
      type: "positive",
      text: `You're saving ${coreMetrics.savingsRate.toFixed(1)}% of your income, exceeding the 20% benchmark by ${savingsDiff.toFixed(1)} percentage points.`,
    });
  } else {
    insights.push({
      type: "neutral",
      text: `At ${coreMetrics.savingsRate.toFixed(1)}%, you're ${Math.abs(savingsDiff).toFixed(1)} percentage points away from the 20% savings benchmark.`,
    });
  }

  // Positive win - find something to celebrate
  if (balanceSheet.netWorth > 0) {
    insights.push({
      type: "positive",
      text: `Your net worth is positive at ${formatCurrency(balanceSheet.netWorth)} - that's a solid foundation to build on!`,
    });
  } else if (coreMetrics.netCashFlow > 0) {
    insights.push({
      type: "positive",
      text: `You saved ${formatCurrency(coreMetrics.netCashFlow)} over this period - every dollar saved is progress!`,
    });
  } else {
    insights.push({
      type: "positive",
      text: `Taking time to review your finances is a great first step. Awareness is the foundation of financial progress!`,
    });
  }

  return insights;
}
