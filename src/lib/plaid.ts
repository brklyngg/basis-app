import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments] || PlaidEnvironments.development,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export const PLAID_PRODUCTS: Products[] = [Products.Transactions];
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];
