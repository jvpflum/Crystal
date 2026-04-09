export interface TelegramTopic {
  name: string;
  threadId: number;
  color: string;
  icon: string;
}

export const TELEGRAM_TOPICS: TelegramTopic[] = [
  { name: "Finance", threadId: 16, color: "#f59e0b", icon: "💰" },
  { name: "Home", threadId: 17, color: "#10b981", icon: "🏠" },
  { name: "System", threadId: 38, color: "#3b82f6", icon: "⚙️" },
  { name: "Neighborhood", threadId: 89, color: "#8b5cf6", icon: "🏘️" },
  { name: "Factory", threadId: 1195, color: "#06b6d4", icon: "🏭" },
];
