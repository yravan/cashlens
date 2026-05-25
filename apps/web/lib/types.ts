export type User = {
  id: number;
  email: string;
  full_name: string | null;
  external_auth_user_id: string | null;
};

export type Account = {
  id: number;
  plaid_item_id: number | null;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number;
  available_balance: number | null;
  iso_currency_code: string;
  last_balance_at: string | null;
};

export type Transaction = {
  id: number;
  raw_transaction_id: number | null;
  account_id: number | null;
  event_type: string;
  direction: "inflow" | "outflow";
  amount: number;
  date: string;
  merchant_name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  is_transfer: boolean;
  is_card_payment: boolean;
  exclude_from_spend: boolean;
  confidence: number;
};

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type PlaidItem = {
  id: number;
  plaid_item_id: string;
  institution_name: string;
  status: string;
  last_synced_at: string | null;
};

export type DashboardSummary = {
  total_cash_balance: number;
  total_credit_balance: number;
  net_inflow_this_month: number;
  net_outflow_this_month: number;
  true_spend_this_month: number;
  latest_sync_status: string;
  unread_notifications: number;
};

export type Dashboard = {
  summary: DashboardSummary;
  accounts: Account[];
  recent_transactions: Transaction[];
  recent_notifications: Notification[];
  plaid_items: PlaidItem[];
};

export type LinkTokenResponse = {
  mode: "demo" | "live";
  link_token: string;
  expiration: string;
};
