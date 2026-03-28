/**
 * Transaction notification data for bot alerts
 */
export interface TransactionNotificationData {
  /**
   * Transaction hash
   */
  hash: string;
  
  /**
   * Whether the transaction was successful
   */
  successful: boolean;
  
  /**
   * Amount transferred
   */
  amount: string;
  
  /**
   * Asset code (e.g., "USDC", "XLM")
   */
  asset: string;
  
  /**
   * Source account address
   */
  from: string;
  
  /**
   * Destination account address
   */
  to: string;
  
  /**
   * Transaction timestamp (ISO string or Unix timestamp)
   */
  timestamp: string | number;
  
  /**
   * Transaction fee in XLM
   */
  fee?: string;
  
  /**
   * Transaction memo
   */
  memo?: string;
  
  /**
   * User ID for the notification
   */
  userId?: string;
  
  /**
   * Ledger number when transaction was confirmed
   */
  ledger?: number;
}

/**
 * Bot notification service configuration
 */
export interface BotNotificationConfig {
  /**
   * Enable Telegram notifications
   */
  telegramEnabled: boolean;
  
  /**
   * Enable Discord notifications
   */
  discordEnabled: boolean;
  
  /**
   * Minimum confirmations before sending notification
   */
  minConfirmations: number;
  
  /**
   * Notification template
   */
  template?: 'minimal' | 'standard' | 'detailed';
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  userId: string;
  
  /**
   * User's Telegram chat ID
   */
  telegramChatId?: string;
  
  /**
   * User's Discord user ID
   */
  discordUserId?: string;
  
  /**
   * Enable transaction notifications
   */
  transactionNotifications: boolean;
  
  /**
   * Enable price alerts
   */
  priceAlerts: boolean;
  
  /**
   * Enable general announcements
   */
  announcements: boolean;
  
  /**
   * Minimum transaction value to notify (in USD)
   */
  minTransactionValue?: number;
}
