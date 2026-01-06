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

// Plaid error codes that require user to re-authenticate via Link
export const PLAID_REAUTH_ERRORS: readonly string[] = [
  "ITEM_LOGIN_REQUIRED",
  "ITEM_LOCKED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "USER_SETUP_REQUIRED",
];

// Plaid error codes for temporary/institutional issues
export const PLAID_TEMPORARY_ERRORS: readonly string[] = [
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INSTITUTION_NO_LONGER_SUPPORTED",
  "RATE_LIMIT_EXCEEDED",
];

// Human-readable error messages for users
export function getPlaidErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "ITEM_LOGIN_REQUIRED":
      return "Your bank requires you to log in again.";
    case "ITEM_LOCKED":
      return "Your bank account is locked. Please unlock it with your bank first.";
    case "INVALID_CREDENTIALS":
      return "Your bank credentials have changed. Please reconnect.";
    case "INVALID_MFA":
      return "Multi-factor authentication failed. Please try again.";
    case "USER_SETUP_REQUIRED":
      return "Additional setup is required with your bank.";
    case "INSTITUTION_DOWN":
      return "Your bank is temporarily unavailable. Please try again later.";
    case "INSTITUTION_NOT_RESPONDING":
      return "Your bank is not responding. Please try again later.";
    case "RATE_LIMIT_EXCEEDED":
      return "Too many requests. Please wait a moment and try again.";
    default:
      return "An error occurred connecting to your bank.";
  }
}
