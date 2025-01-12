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
    ignored?: boolean;
  };

  type Chat = {
    uuid: string;
    name: string;
    systemPrompt: string;
    messages: Message[];
  };

  const defaultStartingMessage: Message = {
    role: "Assistant",
    content: "Ahoy! How can I be lendin' ye a hand today, matey?",
  };

  const defaultSystemPrompt =
    "Ye be a helpful assistant, but ye speak only in the language of pirates. "+
    "Ye respond to all queries in a pirate accent and use pirate-style vocabulary. "+
    "Ye would still provide accurate and helpful information. "+
    "Keep yer tone friendly, humorous, and true to the pirate way of life.\n"+
    "Stay concise, limit yer responses to a maximum of 250 words unless the user requests more details. "+
    "If the user asks an open-ended question or doesn't provide enough detail, "+
    "respond with clarifications or questions to guide the conversation, instead of generating infinite responses.\n"+
    "Avoid modern technical terms unless necessary, and instead, translate them into pirate-like terms and ideas wherever possible.";

  const apiURL = "https://api.coosanta.net/llm/v1/";

  let chats: Chat[] = [];
  let selectedChat: Chat;
  let newMessage = "";
  let isSidebarVisible = true;
  let currentAbortController: AbortController | null = null;
  let isGenerating = false;
  let isLoading = false;

  createNewChat(defaultSystemPrompt);
  addMessage(chats[0].uuid, defaultStartingMessage);
  selectedChat = chats[0];

  async function selectChat(chat: Chat) {
    if (currentAbortController) {
      // Cancels the current streaming if a new chat is selected
      currentAbortController.abort();
      currentAbortController = null;
    }

    const foundChat = chats.find((c) => c.uuid === chat.uuid);
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
    }
  }

  async function sendMessage() {
    if (isLoading) return;
    if (newMessage.trim()) {
      addMessage(selectedChat.uuid, {
        role: "User",
        content: newMessage,
      });
      newMessage = "";
      await tick();
      scrollToBottom();
      await runAssistantResponse();

      if (
        selectedChat.messages.length >= 3 &&
        ["New Chat", "New Conversation", ""].includes(selectedChat.name)
      ) {
        selectedChat.name = "Generating title..."
        selectedChat.name = await generateTitle(selectedChat);
      }
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
    return chats.findIndex((c) => c.uuid === id);
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

      addMessage(selectedChat.uuid, {
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
              appendMessage(selectedChat.uuid, activeMessageIndex, "\n");
            } else {
              appendMessage(selectedChat.uuid, activeMessageIndex, chunk);
            }
          }

          if (line.startsWith("event:")) {
            const eventChunk = line.slice(6);

            if (eventChunk === "generating") {
              addMessage(selectedChat.uuid, {
                role: "System",
                content: "Generating response...",
              });
              isGenerating = true;
              console.debug("Server is generating a response...")

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
          appendMessage(selectedChat.uuid, activeMessageIndex, "\n");
        } else {
          appendMessage(selectedChat.uuid, activeMessageIndex, chunk);
        }
        scrollToBottom();
      }
    } catch (error) {
      if ((error as any).name === "AbortError") {
        console.log("Streaming aborted due to chat switch.");
      } else {
        console.error("Error fetching data from API:", error);
        addMessage(selectedChat.uuid, {
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

  async function processStream(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, resolve: (value: string | PromiseLike<string>) => void, reject: (reason?: any) => void) {
    let buffer = "";
  
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
  
      buffer += decoder.decode(value, { stream: true });
  
      const lines = buffer.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
  
        if (line.startsWith("event:")) {
          const event = line.slice(6).trim(); // Extract the event name

          if (event === "ping") {
            console.debug("Received ping from server when generating title.");

          } else if (event === "generating") {
            console.debug("Server is generating title...");

          } else if (event === "title") {
            const dataLine = lines[i + 1]?.trim();

            if (dataLine?.startsWith("data:")) {
              const data = dataLine.slice(5).trim();

              resolve(data);
              return;
            }
          }
        }
      }
  
      buffer = lines[lines.length - 1];
    }
  
    reject(new Error("No title received."));
  }

  async function createNewChat(inputSystemPrompt: string) {
    chats = [
      ...chats,
      {
        uuid: uuid(),
        name: "New Chat",
        systemPrompt: inputSystemPrompt,
        messages: [],
      },
    ];
    await tick();
  }

  async function generateTitle(conversation: Chat): Promise<string> {
    const url = `${apiURL}completion-title`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(conversation),
    });

    if (!response.body) {
      throw new Error("No response body received.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    return new Promise<string>((resolve, reject) => {
      processStream(reader, decoder, resolve, reject).catch(reject);
    });
  }

  function scrollToBottom() {
    const messagesContainer = document.querySelector(".messages");
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
      console.warn("Messages container not found");
    }
  }

  function hideSidebar() {
    isSidebarVisible = !isSidebarVisible;
  }

  function newChatButtonPressed() {
    createNewChat(defaultSystemPrompt);
    const newChat: Chat = chats[chats.length - 1];
    addMessage(newChat.uuid, defaultStartingMessage);
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
      {#each chats as chat (chat.uuid)}
        <button
          class="sidebar-item {selectedChat.uuid === chat.uuid ? 'active' : ''}"
          on:click={() => selectChat(chat)}
          on:keydown={(e) =>
            (e.key === "Enter" || e.key === " ") && selectChat(chat)}
          role="tab"
          aria-selected={selectedChat.uuid === chat.uuid}
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
