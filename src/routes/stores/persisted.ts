import { persisted } from "svelte-persisted-store";
import { writable } from "svelte/store";

import type { Chat } from "../types";

const initialChat: Chat = {
    uuid: '00000000-0000-0000-0000-000000000000',
    name: "Debug Chat",
    systemPrompt: "You are an unhelpful, useless ai that answers every prompt with \'Something's gone wrong\'.",
    messages: []
}

export const chats = persisted<Chat[]>('chats', [])

export const selectedChat = writable<Chat>(initialChat);

selectedChat.subscribe((updatedChat) => {
    if (updatedChat) {
        chats.update((currentChats) => {
            const chatIndex = currentChats.findIndex(chat => chat.uuid === updatedChat.uuid);

            if (chatIndex !== -1) {
                if (currentChats[chatIndex] !== updatedChat) {
                    return [
                        ...currentChats.slice(0, chatIndex),
                        { ...updatedChat },
                        ...currentChats.slice(chatIndex + 1),
                    ];
                }
            }

            return currentChats;
        });
    }
});
