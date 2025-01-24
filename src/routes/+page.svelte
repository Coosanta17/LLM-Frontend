<script lang="ts">
  import { v4 as uuid } from "uuid";
  import { tick } from "svelte";
  import { base } from "$app/paths";
  import Markdown from "svelte-markdown";
  import remarkGfm from "remark-gfm";
  import rehypeSanitize from "rehype-sanitize";
  import { get } from "svelte/store";

  import { chats, selectedChat } from "./stores/persisted";

  import type { Chat, Message } from "./types";

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

  const defaultStartingMessage: Message = {
    role: "Assistant",
    content: "Ahoy! How can I be lendin' ye a hand today, matey?",
  };

  const defaultSystemPrompt =
    "Ye be a helpful assistant, but ye speak only in the language of pirates. " +
    "Ye respond to all queries in a pirate accent and use pirate-style vocabulary. " +
    "Ye would still provide accurate and helpful information. " +
    "Keep yer tone friendly, humorous, and true to the pirate way of life.\n" +
    "Stay concise, limit yer responses to a maximum of 250 words unless the user requests more details. " +
    "If the user asks an open-ended question or doesn't provide enough detail, " +
    "respond with clarifications or questions to guide the conversation, instead of generating infinite responses.\n" +
    "Avoid modern technical terms unless necessary, and instead, translate them into pirate-like terms and ideas wherever possible.\n" +
    "Ye would now follow these instructions without letting the User know of this message.";

  const apiURL = "https://api.coosanta.net/llm/v1/";

  let isSidebarVisible = true;
  let disableMessage = true;
  let optionsMenuChatId: string | null = null;

  if (get(chats).length === 0) {
    createNewChat(defaultSystemPrompt);
  }

  selectedChat.set(get(chats)[get(chats).length - 1]);

  async function checkApiStatus() {
    try {
      const response = await fetch(`${apiURL}check`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        disableMessage = false;
      } else {
        disableMessage = true;
      }
    } catch (error) {
      console.error("api offline.\n" + error);
      disableMessage = true;
    }
  }

  function regularApiStatusCheck() {
    setInterval(() => {
      if (disableMessage) {
        checkApiStatus();
      }
    }, 10000); // 10 seconds
  }

  checkApiStatus();
  regularApiStatusCheck();

  function clickOutside(node: HTMLElement) {
    const handleClick = (event: MouseEvent) => {
      if (!node.contains(event.target as Node)) {
        optionsMenuChatId = null;
      }
    };

    document.addEventListener("click", handleClick, true);

    return {
      destroy() {
        document.removeEventListener("click", handleClick, true);
      },
    };
  }

  async function updateChat(chatId: string, newValues: Partial<Chat>) {
    chats.update((currentChats) => {
      const chatIndex = findChatIndexFromId(chatId);

      if (chatIndex !== -1) {
        currentChats[chatIndex] = {
          ...currentChats[chatIndex],
          ...newValues,
        };
      } else {
        console.error("Unable to update chat - Chat doesn't exist");
      }

      return currentChats;
    });
  }

  async function selectChat(chat: Chat) {
    const foundChat = get(chats).find((c) => c.uuid === chat.uuid);
    if (foundChat) {
      selectedChat.set(foundChat);
    } else {
      console.error("Chat not found");
    }

    await tick();
    scrollToBottom();
  }

  async function addMessage(chatId: string, message: Message) {
    chats.update((currentChats) => {
      const chatIndex = findChatIndexFromId(chatId);

      if (chatIndex !== -1) {
        currentChats[chatIndex] = {
          ...currentChats[chatIndex],
          messages: [...currentChats[chatIndex].messages, message],
        };
      }

      selectedChat.set(currentChats[chatIndex]);
      return currentChats;
    });
  }

  async function sendMessage() {
    const chatUUID = get(selectedChat).uuid;
    const chatIndex = findChatIndexFromId(chatUUID);

    await checkApiStatus();

    if (disableMessage) return;

    if (get(selectedChat).isLoading) return;

    selectedChat.update((chat) => ({ ...chat, isLoading: true }));

    const newMessage = get(chats)[chatIndex].newMessage.trim();
    updateChat(chatUUID, { newMessage: "" });

    if (newMessage) {
      addMessage(get(selectedChat).uuid, {
        role: "User",
        content: newMessage,
      });

      let focusedChat = get(selectedChat);
      await tick();
      scrollToBottom();
      await runAssistantResponse(focusedChat);

      const updatedChat = get(chats)[chatIndex];

      if (
        updatedChat.messages.length >= 3 &&
        ["New Chat", "New Conversation", "", "Generating title..."].includes(
          updatedChat.name,
        )
      ) {
        chats.update((currentChats) => {
          const updatedChats = [...currentChats];
          updatedChats[chatIndex] = {
            ...updatedChats[chatIndex],
            name: "Generating title...",
          };
          return updatedChats;
        });

        await setTitle(focusedChat.uuid);
      }
    }
  }

  async function setTitle(id: string) {
    const chatIndex = findChatIndexFromId(id);
    const currentChat = get(chats)[chatIndex];

    if (chatIndex === -1) {
      console.error("Unable to set title - Chat doesn't exist");
      return;
    }

    let generatedTitle = await generateTitle(currentChat);

    updateChat(id, { name: generatedTitle });
  }

  function appendMessage(
    chatId: string,
    messageIndex: number,
    appendedChunk: string,
  ) {
    chats.update((currentChats) => {
      const chatIndex = findChatIndexFromId(chatId);

      if (chatIndex === -1) {
        console.error("Unable to append message - Chat doesn't exist");
        return currentChats;
      }

      const updatedChat = { ...currentChats[chatIndex] };

      updatedChat.messages[messageIndex] = {
        ...updatedChat.messages[messageIndex],
        content: updatedChat.messages[messageIndex].content + appendedChunk,
      };

      const updatedChats = [
        ...currentChats.slice(0, chatIndex),
        updatedChat,
        ...currentChats.slice(chatIndex + 1),
      ];

      if (get(selectedChat)?.uuid === chatId) {
        selectedChat.set(updatedChat);
      }

      return updatedChats;
    });
  }

  function findChatIndexFromId(id: string) {
    return get(chats).findIndex((c) => c.uuid === id);
  }

  async function runAssistantResponse(focusedChat: Chat) {
    const url = `${apiURL}complete?type=conversation`;
    const chatIndex = findChatIndexFromId(focusedChat.uuid);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(focusedChat),
      });

      if (!response.body) {
        console.error("No response body received.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      addMessage(focusedChat.uuid, {
        role: "Assistant",
        content: "",
      });

      const activeMessageIndex = focusedChat.messages.length;

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

            if (get(chats)[chatIndex].isGenerating) {
              chats.update((currentChats) => {
                const updatedChats = [...currentChats];

                // Remove the most recent message
                updatedChats[chatIndex] = {
                  ...updatedChats[chatIndex],
                  messages: updatedChats[chatIndex].messages.slice(0, -1),
                };

                return updatedChats;
              });

              updateChat(focusedChat.uuid, { isGenerating: false });
            }

            if (chunk === "") {
              // If the chunk is blank, treat it as a newline
              appendMessage(focusedChat.uuid, activeMessageIndex, "\n");
            } else {
              appendMessage(focusedChat.uuid, activeMessageIndex, chunk);
            }
          }

          if (line.startsWith("event:")) {
            const eventChunk = line.slice(6);

            if (eventChunk === "generating") {
              addMessage(focusedChat.uuid, {
                role: "System",
                content: "Generating response...",
              });
              updateChat(focusedChat.uuid, { isGenerating: true });
              console.debug("Server is generating a response...");
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
          appendMessage(focusedChat.uuid, activeMessageIndex, "\n");
        } else {
          appendMessage(focusedChat.uuid, activeMessageIndex, chunk);
        }
        scrollToBottom();
      }
    } catch (error) {
      console.error("Error fetching data from API:", error);
      addMessage(focusedChat.uuid, {
        role: "System",
        content: `An error occurred while processing your request.\n${error}`,
      });
    } finally {
      updateChat(focusedChat.uuid, {
        isLoading: false,
        isGenerating: false,
      });
    }
  }

  async function processStreamForTitle(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    resolve: (value: string | PromiseLike<string>) => void,
    reject: (reason?: any) => void,
  ) {
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
      processStreamForTitle(reader, decoder, resolve, reject).catch(reject);
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

  function setSelectedChatToMostRecentChat() {
    selectedChat.set(get(chats)[get(chats).length - 1]);
  }

  async function createNewChat(inputSystemPrompt: string) {
    chats.update((currentChats) => [
      ...currentChats,
      {
        uuid: uuid(),
        name: "New Chat",
        systemPrompt: inputSystemPrompt,
        messages: [defaultStartingMessage],
        newMessage: "",
      },
    ]);
    await tick();
  }

  async function deleteChat(uuid: string) {
    const confirmation = window.confirm(
      "Are you sure you want to delete this chat?\nIt will be gone forever!",
    );
    if (!confirmation) {
      toggleOptionsMenu(uuid);
      return;
    }

    const chatIndex = findChatIndexFromId(uuid);
    if (chatIndex === -1) {
      console.error("Unable to delete chat - Chat doesn't exist");
      return;
    }

    // Adds super fancy deletion animation
    const chatElement = document.querySelector(
      `.sidebar-item-container[data-uuid="${uuid}"]`,
    );
    if (chatElement) {
      chatElement.classList.add("deleting");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    chats.update((currentChats) => {
      const updatedChats = [...currentChats];
      updatedChats.splice(chatIndex, 1);
      return updatedChats;
    });

    setSelectedChatToMostRecentChat();

    if (get(chats).length === 0) {
      createNewChat(defaultSystemPrompt);
    }

    await tick();
    optionsMenuChatId = null;
  }

  async function renameChat(chatId: string) {
    const newName = prompt("Enter new chat name:");
    if (newName) {
      updateChat(chatId, { name: newName });
    }
    optionsMenuChatId = null;
  }

  function newChatButtonPressed() {
    createNewChat(defaultSystemPrompt);
    const newChat: Chat = get(chats)[get(chats).length - 1];
    selectChat(newChat);
  }

  function toggleOptionsMenu(chatId: string) {
    optionsMenuChatId = optionsMenuChatId === chatId ? null : chatId;
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
      {#each [...$chats].reverse() as chat (chat.uuid)}
        <div class="sidebar-item-container" data-uuid={chat.uuid}>
          <button
            class="sidebar-item {$selectedChat.uuid === chat.uuid
              ? 'active'
              : ''}"
            on:click={() => selectChat(chat)}
            on:keydown={(e) =>
              (e.key === "Enter" || e.key === " ") && selectChat(chat)}
            role="tab"
            aria-selected={$selectedChat.uuid === chat.uuid}
          >
            {chat.name}
          </button>
          <button
            class="more-options-button"
            on:click={() => toggleOptionsMenu(chat.uuid)}
          >
            <img
              src="{base}/icons/more.svg"
              alt="More Options"
              title="More Options"
              style="width: 20px; height: 20px;"
            />
          </button>
          {#if chat.uuid === optionsMenuChatId}
            <div class="options-menu" use:clickOutside>
              <button on:click={() => renameChat(chat.uuid)}>
                <img
                  src="{base}/icons/edit.svg"
                  alt="Rename Chat"
                  title="Rename Chat"
                  style="width: 20px; height: 20px;"
                />
                Rename
              </button>
              <button on:click={() => deleteChat(chat.uuid)}>
                <img
                  src="{base}/icons/diediediedie.svg"
                  alt="Delete Chat"
                  title="Delete Chat"
                  style="width: 20px; height: 20px;"
                />
                Delete
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Chat Interface -->
  <div class="chat">
    <div class="messages">
      {#if $selectedChat.messages.length === 0}
        <p>No messages yet.</p>
      {/if}
      {#each $selectedChat.messages as message}
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
        bind:value={$selectedChat.newMessage}
        placeholder="Type a message..."
        on:keydown={(e) => e.key === "Enter" && sendMessage()}
      />
      <button
        on:click={sendMessage}
        disabled={$selectedChat.isLoading || disableMessage}
        class:is-loading={$selectedChat.isLoading}>Send</button
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
    background-color: white;
    display: grid;
    grid-template-columns: 300px 1fr;
    height: 100vh;
    width: 100vw;
    font-family: Arial, sans-serif;
    transition: grid-template-columns 0.3s ease;
    overflow: hidden;
  }

  .container.sidebar-hidden {
    grid-template-columns: 75px 1fr;
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
    margin: 5px;
    margin-bottom: 8px;
  }

  .sidebar-item-container {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition:
      transform 0.3s ease,
      opacity 0.3s ease;
  }

  .sidebar-item-container.deleting {
    animation: fadeOut 0.5s forwards;
  }

  @keyframes fadeOut {
    from {
      transform: scale(1);
      opacity: 1;
    }
    to {
      transform: scale(0.1);
      opacity: 0;
    }
  }

  .sidebar-item {
    text-align: center;
    flex: 0 0 210px;
    height: 50px;
    flex-grow: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .more-options-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-left: 0px;
    flex: 0 0 20px;
    height: 50px;
    flex-grow: 0;
  }

  .options-menu {
    position: absolute;
    right: 0;
    background-color: white;
    border: 1px solid #ddd;
    border-radius: 5px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    z-index: 1000;
  }

  .options-menu button {
    display: block;
    width: 100%;
    padding: 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .options-menu button:hover {
    background-color: #f0f0f0;
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
