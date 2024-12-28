<script lang="ts">
  import { v4 as uuid } from "uuid";
  import { tick } from "svelte";
  import { base } from "$app/paths";
  import Markdown from "svelte-markdown";
  import remarkGfm from "remark-gfm";
  import rehypeSanitize from "rehype-sanitize";

  type User = "Assistant" | "User" | "System";

  type Message = {
    user: User;
    content: string;
  };

  type Chat = {
    id: string;
    name: string;
    systemPrompt: string;
    messages: Message[];
  };

  const defaultStartingMessage: Message = {
    user: "Assistant",
    content: "How can I help you?",
  };

  const defaultSystemPrompt = "You are a helpful assistant.";

  let chats: Chat[] = [];
  let selectedChat: Chat;
  let newMessage = "";
  let isSidebarVisible = true;

  createNewChat(defaultSystemPrompt);
  addMessage(chats[0], defaultStartingMessage);
  selectedChat = chats[0];

  const markdownOptions = {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [
        rehypeSanitize,
        {
          allowDangerousHtml: true,
          tagNames: [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "ul",
            "ol",
            "li",
            "blockquote",
          ],
          attributes: {
            "*": ["class", "id", "style"],
          }, // Allow styles for better display
        },
      ],
    ],
  };

  async function selectChat(chat: Chat) {
    selectedChat = chat;
    await tick();
    scrollToBottom();
  }

  async function addMessage(chat: Chat, message: Message) {
    chat.messages = [...chat.messages, message];
    selectedChat = { ...chat }; // Ensure Svelte recognizes the update
    chats = [...chats]; // Update the chats array
  }

  async function sendMessage() {
    if (newMessage.trim()) {
      addMessage(selectedChat, {
        user: "User",
        content: newMessage,
      });
      newMessage = "";
      await tick();
      scrollToBottom();
      runAssistantResponse();
    }
  }

  async function runAssistantResponse() {
    // const response = `You said: \"${selectedChat.messages[selectedChat.messages.length - 1].content}\"`; // Example response
    const response = `
# Heading Example
- List Item 1
- List Item 2

> This is a quote
`; // debug
    addMessage(selectedChat, {
      user: "Assistant",
      content: response,
    });
    await tick();
    scrollToBottom();
  }

  function scrollToBottom() {
    const messagesContainer = document.querySelector(".messages");
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
      console.warn("Messages container not found");
    }
  }

  async function createNewChat(inputSystemPrompt: string) {
    chats = [
      ...chats,
      {
        id: uuid(),
        name: "New Chat",
        systemPrompt: inputSystemPrompt,
        messages: [],
      },
    ];
    await tick();
  }

  function hideSidebar() {
    isSidebarVisible = !isSidebarVisible;
  }

  function newChatButtonPressed() {
    createNewChat(defaultSystemPrompt);
    const newChat: Chat = chats[chats.length - 1];
    addMessage(newChat, defaultStartingMessage)
    selectChat(newChat);
  }
</script>

<div class="container {isSidebarVisible ? '' : 'sidebar-hidden'}">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-actions-menu">
      <div class="sidebar-hide">
        <button
          on:click={hideSidebar}
          on:keydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              hideSidebar();
            }
          }}
        >
          <img
            src="{base}/icons/sidebar.svg"
            alt="Icon of Sidebar"
            title="Hide sidebar"
            style="width: 20px; height: 20px;"
          />
        </button>
      </div>

      {#if isSidebarVisible}
        <!-- New Chat Button -->
        <div class="new-chat">
          <button
            on:click={() => newChatButtonPressed()}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") newChatButtonPressed();
            }}
          >
            <img
              src="{base}/icons/new_chat.svg"
              alt="New Chat Icon"
              title="New chat"
              style="width: 20px; height: 20px;"
            />
          </button>
        </div>
      {/if}
    </div>

    {#if isSidebarVisible}
      <!-- Select Chats -->
      {#each chats as chat (chat.id)}
        <button
          class="sidebar-item {selectedChat.id === chat.id ? 'active' : ''}"
          on:click={() => selectChat(chat)}
          on:keydown={(e) =>
            (e.key === "Enter" || e.key === " ") && selectChat(chat)}
          role="tab"
          aria-selected={selectedChat.id === chat.id}
        >
          {chat.name}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Chat Interface -->
  <div class="chat">
    <div class="messages">
      {#if selectedChat.messages.length === 0}
        <p>No messages yet.</p>
      {/if}
      {#each selectedChat.messages as message}
        <div class="message {message.user.toLowerCase()}">
          {#if message.user === "Assistant"}
            <Markdown
              options={markdownOptions}
              source={String(message.content)}
            />
          {:else}
            <span>{message.content}</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="input-container">
      <input
        type="text"
        bind:value={newMessage}
        placeholder="Type a message..."
        on:keydown={(e) => e.key === "Enter" && sendMessage()}
      />
      <button on:click={sendMessage}>Send</button>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    height: 100%;
    overflow: hidden;
  }

  .container {
    display: grid;
    grid-template-columns: 15% 1fr;
    height: 100vh;
    width: 100vw;
    font-family: Arial, sans-serif;
    transition: grid-template-columns 0.3s ease;
    overflow: hidden;
  }

  .container.sidebar-hidden {
    grid-template-columns: 74px 1fr;
  }

  .sidebar {
    background-color: rgb(244, 244, 244);
    border-right: 1px solid rgb(221, 221, 221);
    overflow-y: auto;
    padding: 1%;
  }

  .sidebar button {
    display: block;
    width: 100%;
    padding: 10px 20px;
    background-color: rgb(251, 251, 251);
    color: black;
    border: transparent;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
  }

  .sidebar button:hover {
    background-color: rgb(200, 200, 200);
  }

  .sidebar button.active {
    background-color: rgb(220, 220, 220);
  }

  .sidebar-actions-menu {
    display: flex;
    justify-content: space-between;
    margin: 8px;
  }

  .new-chat button {
    background-color: rgb(244, 244, 244);
    color: black;
    border: transparent;
    border-radius: 5px;
    cursor: pointer;
  }

  .new-chat button:hover {
    background-color: rgb(200, 200, 200);
  }

  .sidebar-hide button {
    background-color: rgb(244, 244, 244);
    color: black;
    border: transparent;
    border-radius: 5px;
    cursor: pointer;
  }

  .sidebar-hide button:hover {
    background-color: rgb(200, 200, 200);
  }

  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .messages {
    flex: 1;
    padding: 25px 30px 15px 30px;
    overflow-y: auto;
    background-color: #fafafa;
    border-bottom: 1px solid #ddd;
    max-height: 100%;
  }

  .message {
    margin-bottom: 10px;
    padding: 10px;
    border-radius: 5px;
    max-width: 70%;
    word-break: break-word;
  }

  .message.assistant {
    background-color: transparent;
    text-align: left;
  }

  .message.user {
    background-color: #e0e0e0;
    margin-left: auto;
    text-align: left;
    max-width: 60%;
  }

  .input-container {
    display: flex;
    padding: 15px;
    background-color: #f4f4f4;
  }

  .input-container input {
    flex: 1;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 5px;
    margin-right: 10px;
    word-break: break-all;
  }

  .input-container button {
    padding: 10px 20px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
  }

  .input-container button:hover {
    background-color: #0056b3;
  }
</style>
