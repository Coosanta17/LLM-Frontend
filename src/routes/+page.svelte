<script lang="ts">
  import { v4 as uuid } from "uuid";
  import { tick } from "svelte";
  import { base } from "$app/paths";
  import Markdown from "svelte-markdown";
  import remarkGfm from "remark-gfm";
  import rehypeSanitize from "rehype-sanitize";

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
          },
        },
      ],
    ],
  };

  type Role = "Assistant" | "User" | "System";

  type Message = {
    role: Role;
    content: string;
  };

  type Chat = {
    id: string;
    name: string;
    systemPrompt: string;
    messages: Message[];
  };

  const defaultStartingMessage: Message = {
    role: "Assistant",
    content: "Arrr, how can I be lendin' ye a hand todays, matey?",
  };

  const defaultSystemPrompt =
    "Ye be a helpful assistant, but ye speak only in the language of pirates. Ye respond to all queries in a pirate accent and use pirate-style vocabulary. Ye would still providing accurate and helpful information. Keep yer tone friendly, humorous, and true to the pirate way of life.\nStay concise, limit yer responses to a maximum of 250 words unless the user requests more details. If the user asks an open-ended question or doesn't provide enough detail, respond with clarifications or questions to guide the conversation, instead of generating infinite responses.\nRemember: Always stay in character as a pirate, but never lose focus on helpin' the user. Avoid modern technical terms unless necessary, and instead, translate them into pirate-like terms wherever possible.";

  const apiURL = "https://api.coosanta.net/llm/v1/";

  let chats: Chat[] = [];
  let selectedChat: Chat;
  let newMessage = "";
  let isSidebarVisible = true;
  let currentAbortController: AbortController | null = null;
  let isGenerating = false;
  let isLoading = false;

  createNewChat(defaultSystemPrompt);
  addMessage(chats[0].id, defaultStartingMessage);
  selectedChat = chats[0];

  async function selectChat(chat: Chat) {
    if (currentAbortController) {
      // Cancels the current streaming if a new chat is selected
      currentAbortController.abort();
      currentAbortController = null;
    }

    const foundChat = chats.find((c) => c.id === chat.id);
    if (foundChat) {
      selectedChat = foundChat;
    } else {
      console.error("Chat not found");
    }

    await tick();
    scrollToBottom();
  }

  async function addMessage(chatId: string, message: Message) {
    const chatIndex = findChatIndexFromId(chatId);

    if (chatIndex !== -1) {
      chats[chatIndex] = {
        ...chats[chatIndex],
        messages: [...chats[chatIndex].messages, message],
      };

      selectedChat = chats[chatIndex];

      chats = [...chats];

      if (selectedChat.messages.length >= 3) {
        selectedChat.name = await generateTitle(selectedChat);
      }
    }
  }

  async function sendMessage() {
    if (isLoading) return;
    if (newMessage.trim()) {
      addMessage(selectedChat.id, {
        role: "User",
        content: newMessage,
      });
      newMessage = "";
      await tick();
      scrollToBottom();
      await runAssistantResponse();
    }
  }

  async function appendMessage(
    chatId: string,
    messageIndex: number,
    appendedChunk: string,
  ) {
    const chatIndex = findChatIndexFromId(chatId);

    if (chatIndex !== -1) {
      // Kind of confusing but it works so I'm not changing it.
      chats[chatIndex] = {
        ...chats[chatIndex],
        messages: chats[chatIndex].messages.map((message, index) =>
          index === messageIndex
            ? {
                ...message,
                content: message.content + appendedChunk,
              }
            : message,
        ),
      };

      selectedChat = chats[chatIndex];

      chats = [...chats];
    }
  }

  function findChatIndexFromId(id: string) {
    return chats.findIndex((c) => c.id === id);
  }

  async function runAssistantResponse() {
    const url = `${apiURL}complete?type=conversation`;

    currentAbortController = new AbortController();

    isLoading = true;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedChat),
        signal: currentAbortController.signal,
      });

      if (!response.body) {
        console.error("No response body received.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      addMessage(selectedChat.id, {
        role: "Assistant",
        content: "",
      });

      const activeMessageIndex = selectedChat.messages.length - 1;

      let buffer = ""; // Buffer for accumulating data between chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process SSE lines
        const lines = buffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];

          if (line.startsWith("data:")) {
            const chunk = line.slice(5);

            if (isGenerating) {
              selectedChat.messages.pop();
              isGenerating = false;
            }

            if (chunk === "") {
              // If the chunk is blank (e.g., `data:` followed by no content), treat it as a newline
              appendMessage(selectedChat.id, activeMessageIndex, "\n");
            } else {
              appendMessage(selectedChat.id, activeMessageIndex, chunk);
            }
          }

          if (line.startsWith("event:")) {
            const eventChunk = line.slice(6);

            if (eventChunk === "generating") {
              addMessage(selectedChat.id, {
                role: "System",
                content: "Generating response...",
              });
              isGenerating = true;
            } else if (eventChunk === "ping") {
              console.debug("Received ping from server.");
            }
          }
        }

        // Save the last line in the buffer for the next iteration
        buffer = lines[lines.length - 1];
        await tick();
        scrollToBottom();
      }

      if (buffer.startsWith("data:")) {
        const chunk = buffer.slice(5);
        if (chunk === "") {
          appendMessage(selectedChat.id, activeMessageIndex, "\n");
        } else {
          appendMessage(selectedChat.id, activeMessageIndex, chunk);
        }
        scrollToBottom();
      }
    } catch (error) {
      if ((error as any).name === "AbortError") {
        console.log("Streaming aborted due to chat switch.");
      } else {
        console.error("Error fetching data from API:", error);
        addMessage(selectedChat.id, {
          role: "System",
          content: "An error occurred while processing your request.",
        });
      }
    } finally {
      currentAbortController = null;
      isGenerating = false;
      isLoading = false;
    }
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

  async function generateTitle(conversation: Chat): Promise<string> {
    const url = `${apiURL}completion-title`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(conversation),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error: ${errorText}`);
      }

      const title = await response.text();
      return title;
    } catch (error: any) {
      throw new Error(
        "An unexpected error occurred while generating the title",
      );
    }
  }

  function hideSidebar() {
    isSidebarVisible = !isSidebarVisible;
  }

  function newChatButtonPressed() {
    createNewChat(defaultSystemPrompt);
    const newChat: Chat = chats[chats.length - 1];
    addMessage(newChat.id, defaultStartingMessage);
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
        <div class="message {message.role.toLowerCase()}">
          {#if message.role === "Assistant"}
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
      <button
        on:click={sendMessage}
        disabled={isLoading}
        class:is-loading={isLoading}>Send</button
      >
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

  .input-container button:disabled {
    background-color: grey;
    cursor: not-allowed;
  }
</style>
