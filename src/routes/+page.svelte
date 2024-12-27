<script>
  import { v4 as uuid } from "uuid";
  import { tick } from "svelte";
  import { base } from "$app/paths";
  import Markdown from "svelte-markdown";
  import remarkGfm from "remark-gfm";
  import rehypeSanitize from "rehype-sanitize";

  let chats = [
    {
      id: uuid(),
      name: "New Chat",
      systemPrompt: "You are a helpful assistant.",
      messages: [{ user: "Assistant", content: "How can I help you?" }],
    },
  ];

  let selectedChat = chats[0];
  let newMessage = "";
  let isSidebarVisible = true;

  const markdownOptions = {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [
        rehypeSanitize,
        {
          allowDangerousHtml: false,
        },
      ],
    ],
  };

  /**
   * @param {{ id: string, name: string, systemPrompt: string, messages: { user: string, content: string }[] }} chat
   */
  async function selectChat(chat) {
    selectedChat = chat;
    await tick();
    scrollToBottom();
  }

  async function sendMessage() {
    if (newMessage.trim()) {
      selectedChat.messages = [
        ...selectedChat.messages,
        { user: "User", content: newMessage },
      ];
      newMessage = "";
      await tick();
      scrollToBottom();
      runAssistantResponse();
    }
  }

  async function runAssistantResponse() {
    const response = `You said: "${selectedChat.messages[selectedChat.messages.length - 1].content}"`; // Example response
    selectedChat.messages = [
      ...selectedChat.messages,
      { user: "Assistant", content: response },
    ];
    await tick();
    scrollToBottom();
  }

  function scrollToBottom() {
    const messagesContainer = document.querySelector(".messages");
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  async function newChat() {
    chats = [
      ...chats,
      {
        id: uuid(),
        name: "placeholder name",
        systemPrompt: "You are a helpful assistant.",
        messages: [{ user: "Assistant", content: "How can I help you?" }],
      },
    ];
    await tick();
  }

  function hideSidebar() {
    isSidebarVisible = !isSidebarVisible;
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
        <div class="new-chat">
          <button
            on:click={() => {
              newChat();
              selectChat(chats[chats.length - 1]);
            }}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                newChat();
                selectChat(chats[chats.length - 1]);
              }
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
            <Markdown options={markdownOptions} source={message.content} />
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

  .message.assistant h1,
  .message.assistant h2,
  .message.assistant h3,
  .message.assistant h4,
  .message.assistant h5,
  .message.assistant h6 {
    margin: 0;
    padding: 0;
  }

  .message.assistant h1 {
    font-size: 2em;
    margin-bottom: 0.5em;
  }

  .message.assistant h2 {
    font-size: 1.5em;
    margin-bottom: 0.75em;
  }

  .message.assistant h3 {
    font-size: 1.25em;
    margin-bottom: 1em;
  }

  .message.assistant h4 {
    font-size: 1em;
    margin-bottom: 1.25em;
  }

  .message.assistant h5 {
    font-size: 0.875em;
    margin-bottom: 1.5em;
  }

  .message.assistant h6 {
    font-size: 0.75em;
    margin-bottom: 1.75em;
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
