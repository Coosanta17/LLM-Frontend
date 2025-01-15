export type Role = "Assistant" | "User" | "System";

export type Message = {
    role: Role;
    content: string;
    ignored?: boolean;
};

export type Chat = {
    uuid: string;
    name: string;
    systemPrompt: string;
    messages: Message[];
};