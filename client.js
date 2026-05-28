const socket = io();
const messagesDiv = document.getElementById("messages");

messagesDiv.addEventListener("scroll", () => {
  // =========================
  // DETECTA SE ESTÁ NO FINAL
  // =========================

  const threshold = 100;

  isUserAtBottom =
    messagesDiv.scrollHeight -
      messagesDiv.scrollTop -
      messagesDiv.clientHeight <
    threshold;

  // =========================
  // CARREGAR MAIS MENSAGENS
  // =========================

  if (messagesDiv.scrollTop <= 0 && !loadingOldMessages) {
    loadingOldMessages = true;

    const oldestMessage = document.querySelector(".message");

    const oldestId = oldestMessage?.dataset.id;

    socket.emit("load_more_messages", {
      room: currentRoom,
      oldestId,
    });

    setTimeout(() => {
      loadingOldMessages = false;
    }, 500);
  }
});

const messageInput = document.getElementById("message-input");

messageInput.addEventListener("input", () => {
  socket.emit("typing", {
    room: currentRoom,
    user: currentUser,
  });
});

let isUserAtBottom = true;
let replyingTo = null;
let loadingOldMessages = false;
let unreadMessages = {};
let currentUser = null;
let currentAvatar = "/uploads/default-avatar.png";
let currentRoom = "geral";
let isLoginMode = true;
let privateChats = JSON.parse(localStorage.getItem("privateChats")) || [];
let unreadCounts = {};

function toggleAuthMode() {
  isLoginMode = !isLoginMode;

  document.getElementById("auth-submit-btn").innerText = isLoginMode
    ? "Entrar"
    : "Registrar";

  document.getElementById("auth-toggle-text").innerText = isLoginMode
    ? "Criar conta"
    : "Já tenho conta";
}

function handleAuth() {
  const username = document.getElementById("auth-user").value;

  const password = document.getElementById("auth-pass").value;

  socket.emit(isLoginMode ? "login" : "register", { username, password });
}

socket.on("user_typing", (data) => {
  const typing = document.getElementById("typing-indicator");

  typing.innerText = `${data.user} está digitando...`;

  clearTimeout(window.typingTimeout);

  window.typingTimeout = setTimeout(() => {
    typing.innerText = "";
  }, 1500);
});

socket.on("auth_success", (data) => {
  currentUser = data.username;
  currentAvatar = data.avatar;

  window.isAdmin = data.isAdmin;

  console.log(data);
  console.log("É admin?", data.isAdmin);

  document.getElementById("auth-overlay").style.display = "none";

  document.getElementById("my-name").innerText = currentUser;

  document.getElementById("my-avatar").src = currentAvatar;

  socket.emit("switch_room", "geral");

  socket.emit("get_users");

  if (data.isAdmin === 1) {
    const eyeBtn = document.getElementById("admin-monitor-btn");
    if (eyeBtn) eyeBtn.style.display = "block";
  }

  if (data.isAdmin) {
    document.getElementById("admin-channel").classList.remove("hidden");
  }

  // === ADICIONE ESTE BLOCO AQUI ===
  const btnAdminLogs = document.getElementById("btn-admin-logs");
  if (btnAdminLogs) {
    if (data.isAdmin === 1) {
      btnAdminLogs.style.display = "flex"; // Mostra se for admin
    } else {
      btnAdminLogs.style.display = "none"; // Esconde completamente se for usuário comum
    }
  }
  // ================================

  socket.emit("switch_room", currentRoom);
});

socket.on("auth_error", alert);

function changeRoom(event, room) {
  currentRoom = room;

  document.getElementById("messages").innerHTML = "";

  socket.emit("switch_room", room);

  document
    .querySelectorAll(".channel-btn")
    .forEach((btn) => btn.classList.remove("active-room"));

  if (event) {
    event.currentTarget.classList.add("active-room");
  }

  document.getElementById("header-name").innerText = room;

  clearNotification(room);
}

function openDM(targetUser) {
  const username =
    typeof targetUser === "object" ? targetUser.username : targetUser;

  if (!username || username === currentUser) return;

  const room = [currentUser, username].sort().join("_pm_");

  currentRoom = room;

  document.getElementById("messages").innerHTML = "";

  socket.emit("switch_room", room);

  const exists = privateChats.some((u) => (u.username || u) === username);

  if (!exists) {
    privateChats.push({
      username,
      avatar: targetUser.avatar || "/uploads/default-avatar.png",
    });

    localStorage.setItem("privateChats", JSON.stringify(privateChats));
  }

  renderPrivateChats();

  updateHeader(username, true);
}

function renderPrivateChats() {
  const dmList = document.getElementById("dm-list");

  dmList.innerHTML = "";

  privateChats.forEach((user) => {
    const username = user.username || user;

    const avatar = user.avatar || "/uploads/default-avatar.png";

    const div = document.createElement("div");

    div.className = "channel-btn";

    div.innerHTML = `
            <div style="
                display:flex;
                align-items:center;
                gap:8px;
            ">
                <img
                    src="${avatar}"
                    style="
                        width:32px;
                        height:32px;
                        border-radius:50%;
                        object-fit:cover;
                    "
                >

                <span>${username}</span>
            </div>
        `;

    div.onclick = () => openDM(user);

    dmList.appendChild(div);
  });
}

document.getElementById("message-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = e.target.value.trim();
    if (!text) return;

    // Envia a mensagem incluindo os dados da resposta (se houver)
    socket.emit("chat message", {
      room: currentRoom,
      user: currentUser,
      avatar: currentAvatar,
      text,
      reply_to_id: replyingTo,
      reply_to_id: replyingTo ? replyingTo.id : null,
      reply_user: replyingTo ? replyingTo.user : null,
      reply_text: replyingTo ? replyingTo.text : null,
    });

    e.target.value = "";
    replyingTo = null; // <-- Limpa a variável para a próxima mensagem
    cancelReply(); // Fecha a barra cinza de preview após enviar
  }
});

socket.on("ai_response", (data) => {
  addMessage({
    user: "IA",
    avatar: "/uploads/default-avatar.png",
    text: data.text,
  });
});

socket.on("chat message", (data) => {
  if (data.room !== currentRoom) {
    unreadMessages[data.room] = (unreadMessages[data.room] || 0) + 1;

    updateNotifications();
    replyToId: replyingTo;
  }

  addMessage(data);
});

function createMessageElement(data) {
  const div = document.createElement("div");

  const isMe = data.user === currentUser;

  div.className = `message ${isMe ? "sent" : "received"}`;

  div.dataset.id = data.id;

  div.innerHTML = `
    <img
      src="${data.avatar}"
      class="msg-avatar"
    >

    <div class="msg-content">

      <span class="msg-author">
        ${isMe ? "Você" : data.user}
      </span>

      <span>
        ${data.text || ""}
      </span>

      ${
        data.image_url
          ? `
            <img
              src="${data.image_url}"
              class="chat-img"
            >
          `
          : ""
      }

    </div>
  `;

  return div;
}

function addMessage(data) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");

  div.id = `msg-${data.id}`;
  const isMe = data.user === currentUser;

  div.className = `message ${isMe ? "sent" : "received"}`;
  div.dataset.id = data.id;

  // Se o usuário der dois cliques na mensagem, ativa o modo de resposta automaticamente!
  div.ondblclick = () => {
    startReply(data.id, data.user, data.text || "Imagem");
  };

  // Trata aspas para não quebrar o HTML dos botões abaixo
  const safeUser = data.user.replace(/'/g, "\\'");
  const safeText = (data.text || "Imagem")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");

  // Se essa mensagem for uma resposta, cria o balãozinho de citação superior
  const replyHTML = data.reply_to_id
    ? `
    <div class="reply-reference" onclick="goToPinnedMessage(${data.reply_to_id})" style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 0.8rem; color: #b9bbbe; opacity: 0.8;">
        <span style="color: #5865f2; font-weight: bold;">⤹</span>
        <strong>@${data.reply_user}</strong>: <span style="font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${data.reply_text}</span>
    </div>
  `
    : "";

  div.innerHTML = `
    <img src="${data.avatar}" class="msg-avatar">

    <div class="msg-content">

        ${replyHTML}

        <div class="message-top">

            <span class="msg-author">
                ${isMe ? "Você" : data.user}
            </span>

            <div class="message-actions">
                
                <button 
                    class="reply-btn-quick" 
                    onclick="startReply(${data.id}, '${safeUser}', '${safeText}')"
                    style="background: none; border: none; color: #b9bbbe; cursor: pointer; font-size: 0.9rem; margin-right: 4px;" 
                    title="Responder">
                    ↩️
                </button>

                ${
                  window.isAdmin || isMe
                    ? `
                    <button
                        class="menu-btn"
                        onclick="toggleMessageMenu(event, ${data.id})">
                        ⋮
                    </button>

                    <div
                        class="message-menu"
                        id="menu-${data.id}">

                        <button
                            onclick="deleteMessage(${data.id})">
                            🗑️ Apagar
                        </button>

                        ${
                          data.pinned
                            ? `
                            <button
                                class="message-action danger pin-toggle-btn"
                                onclick="unpinMessage(${data.id})">
                                Desfixar
                            </button>
                          `
                            : `
                            <button
                                class="message-action pin-toggle-btn"
                                onclick="pinMessage(${data.id})">
                                Fixar
                            </button>
                           `
                        }
                        ${
                          isMe
                            ? `
                          <button
                              class="edit-btn"
                              onclick="editMessage(${data.id})">
                              Editar
                          </button>
                        `
                            : ""
                        }
                    </div>
                `
                    : ""
                }

            </div>

        </div>

        <span>${data.text || ""}</span>

        ${
          data.image_url ? `<img src="${data.image_url}" class="chat-img">` : ""
        }

    </div>
  `;

  container.appendChild(div);

  if (isUserAtBottom) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }
}

socket.on("load_history", (messages) => {
  document.getElementById("messages").innerHTML = "";

  messages.forEach(addMessage);
});

socket.on("refresh_users", () => {
  socket.emit("get_users");
});

socket.on("user_list", (users) => {
  const list = document.getElementById("user-list");

  list.innerHTML = "";

  document.getElementById("user-count").innerText = users.length;

  users.forEach((user) => {
    if (user.username === currentUser) return;

    const div = document.createElement("div");

    div.className = "user-item";

    div.onclick = () => openDM(user);

    div.innerHTML = `
    <div class="user-left">

        <div class="status-dot ${user.online ? "online" : "offline"}"></div>

        <img src="${user.avatar}" class="user-avatar">

        <span>${user.username}</span>

    </div>

    ${
      window.isAdmin
        ? `
        <div class="admin-actions">

            ${
              user.isMuted
                ? `
                <button
                    class="admin-btn btn-unmute"
                    onclick="event.stopPropagation(); unmuteUser('${user.username}')">
                    Unmute
                </button>
            `
                : `
                <button
                    class="admin-btn btn-mute"
                    onclick="event.stopPropagation(); muteUser('${user.username}')">
                    Mute
                </button>
            `
            }
             ${
               user.isBanned
                 ? ""
                 : `
            <button
                class="admin-btn btn-ban"
                onclick="event.stopPropagation(); banUser('${user.username}')">
                Ban
            </button>
            `
             }

        </div>
    `
        : ""
    }
`;

    list.appendChild(div);
  });
});

function muteUser(username) {
  socket.emit("mute_user", {
    admin: currentUser,
    target: username,
  });
}

function unmuteUser(username) {
  socket.emit("unmute_user", {
    admin: currentUser,
    target: username,
  });
}

function banUser(username) {
  const confirmar = confirm(`Banir ${username}?`);

  if (!confirmar) return;

  socket.emit("ban_user", {
    admin: currentUser,
    target: username,
  });
}

function editMessage(id) {
  const novoTexto = prompt("Editar mensagem:");

  if (!novoTexto) return;

  socket.emit("edit_message", {
    id,
    text: novoTexto,
  });
}

function addNotification(room) {
  unreadCounts[room] = (unreadCounts[room] || 0) + 1;

  const badge = document.getElementById(`badge-${room}`);

  if (!badge) return;

  badge.classList.remove("hidden");

  badge.innerText = unreadCounts[room];
}

function clearNotification(room) {
  unreadCounts[room] = 0;

  const badge = document.getElementById(`badge-${room}`);

  if (!badge) return;

  badge.classList.add("hidden");
}

document.getElementById("search-input").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();

  document.querySelectorAll(".message").forEach((msg) => {
    msg.style.display = msg.innerText.toLowerCase().includes(term)
      ? "flex"
      : "none";
  });
});

async function sendPhoto() {
  const file = document.getElementById("file-image").files[0];

  const formData = new FormData();

  formData.append("image", file);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();

  socket.emit("chat message", {
    room: currentRoom,
    user: currentUser,
    avatar: currentAvatar,
    image_url: data.url,
  });
}

function toggleModal(id, show) {
  document.getElementById(id).style.display = show ? "flex" : "none";
}

function previewFile() {
  const file = document.getElementById("file-avatar").files[0];

  const reader = new FileReader();

  reader.onloadend = () => {
    document.getElementById("preview-img").src = reader.result;
  };

  reader.readAsDataURL(file);
}

async function saveProfile() {
  const file = document.getElementById("file-avatar").files[0];

  const newName = document.getElementById("new-name").value;

  let avatar = currentAvatar;

  if (file) {
    const formData = new FormData();

    formData.append("image", file);

    const res = await fetch("/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    avatar = data.url;
  }

  socket.emit("update_profile", {
    oldName: currentUser,
    newName,
    newAvatar: avatar,
  });
}

socket.on("profile_updated", (data) => {
  currentUser = data.username;
  currentAvatar = data.avatar;

  document.getElementById("my-name").innerText = currentUser;

  document.getElementById("my-avatar").src = currentAvatar;

  toggleModal("settings-modal", false);
});

function logout() {
  location.reload();
}

function updateNotifications() {
  document.querySelectorAll(".channel-btn").forEach((btn) => {
    const room = btn.dataset.room;

    if (!room) return;

    const count = unreadMessages[room] || 0;

    let badge = btn.querySelector(".notif-badge");

    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");

        badge.className = "notif-badge";

        btn.appendChild(badge);
      }

      badge.innerText = count;
    } else {
      if (badge) badge.remove();
    }
  });
}

socket.on("older_messages", (rows) => {
  const container = document.getElementById("messages");

  const oldHeight = container.scrollHeight;

  rows.forEach((msg) => {
    const div = createMessageElement(msg);

    container.prepend(div);
  });

  const newHeight = container.scrollHeight;

  container.scrollTop = newHeight - oldHeight;
});

function editMessage(id) {
  const novoTexto = prompt("Editar mensagem:");

  if (!novoTexto) return;

  socket.emit("edit_message", {
    id,
    text: novoTexto,
  });
}

socket.on("message_edited", (data) => {
  const mensagens = document.querySelectorAll(".message");

  mensagens.forEach((msg) => {
    const button = msg.querySelector(".edit-btn");

    if (button && button.getAttribute("onclick").includes(data.id)) {
      const texto = msg.querySelector(".msg-text");

      texto.innerText = data.text + " (editado)";
    }
  });
});

function toggleTheme() {
  document.body.classList.toggle("light-theme");
}

function deleteMessage(messageId) {
  socket.emit("delete_message", {
    messageId,
    admin: currentUser,
  });
}

socket.on("message_deleted", (messageId) => {
  const msg = document.getElementById(`msg-${messageId}`);

  if (msg) {
    msg.remove();
  }
});

function pinMessage(messageId) {
  socket.emit("pin_message", {
    messageId,
    admin: currentUser,
  });
}

function toggleMessageMenu(event, id) {
  event.stopPropagation();

  document.querySelectorAll(".message-menu").forEach((menu) => {
    if (menu.id !== `menu-${id}`) {
      menu.style.display = "none";
    }
  });

  const menu = document.getElementById(`menu-${id}`);

  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

document.addEventListener("click", () => {
  document.querySelectorAll(".message-menu").forEach((menu) => {
    menu.style.display = "none";
  });
});

function goToPinnedMessage(messageId) {
  const message = document.getElementById(`msg-${messageId}`);

  if (!message) return;

  message.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  message.classList.add("highlight-message");

  setTimeout(() => {
    message.classList.remove("highlight-message");
  }, 3000);
}

socket.on("message_pin_updated", (messageData) => {
  const message = document.querySelector(
    `.message[data-id="${messageData.id}"]`,
  );

  if (message) {
    const pinBtn = message.querySelector(".pin-toggle-btn");

    if (pinBtn) {
      if (messageData.pinned === 1) {
        pinBtn.innerText = "Desfixar";

        pinBtn.setAttribute("onclick", `unpinMessage(${messageData.id})`);
      } else {
        pinBtn.innerText = "Fixar";

        pinBtn.setAttribute("onclick", `pinMessage(${messageData.id})`);
      }
    }
  }

  const container = document.getElementById("pinned-message-container");

  const content = document.getElementById("pinned-message-content");

  if (messageData.pinned === 1) {
    container.classList.remove("hidden");

    content.innerHTML = `
      <div class="pinned-top-bar">

          <div
            class="pinned-message-clickable"
            onclick="goToPinnedMessage(${messageData.id})">

              <strong>${messageData.user}</strong>

              <span>
                ${messageData.text || "Imagem"}
              </span>

          </div>

          ${
            window.isAdmin
              ? `
              <button
                class="unpin-top-btn"
                onclick="unpinMessage(${messageData.id})">
                Desfixar
              </button>
            `
              : ""
          }

      </div>
    `;
  } else {
    container.classList.add("hidden");
  }
});

socket.on("message_unpinned", ({ messageId }) => {
  const message = document.querySelector(`.message[data-id="${messageId}"]`);

  if (!message) return;

  const isPinned = message.querySelector(".danger pin-toggle-btn");

  if (isPinned) {
    isPinned.innerText = "Fixar";

    isPinned.setAttribute("onclick", `pinMessage(${messageId})`);
  }

  const pinnedContainer = document.getElementById("pinned-message-container");

  pinnedContainer.classList.add("hidden");
});

function unpinMessage(messageId) {
  socket.emit("unpin_message", {
    messageId,
  });
}

const searchBtn = document.getElementById("search-toggle-btn");

const searchContainer = document.getElementById("search-container");

const searchInput = document.getElementById("search-input");

searchBtn.addEventListener("click", () => {
  searchContainer.classList.toggle("active");

  if (searchContainer.classList.contains("active")) {
    searchContainer.classList.remove("hidden-search");

    searchInput.focus();
  } else {
    searchContainer.classList.add("hidden-search");

    searchInput.value = "";

    // resetar mensagens
    document.querySelectorAll(".message").forEach((msg) => {
      msg.style.display = "flex";
    });
  }
});

function toggleLeftSidebar() {
  const sidebar = document.getElementById("left-sidebar");

  sidebar.classList.toggle("hidden-sidebar");
}

function toggleRightSidebar() {
  const sidebar = document.getElementById("right-sidebar");

  sidebar.classList.toggle("hidden-sidebar");
}

// Ativa o modo de resposta guardando os dados da mensagem pai
function startReply(messageId, user, text) {
  replyingTo = { id: messageId, user: user, text: text };

  const previewBox = document.getElementById("reply-preview-box");
  const previewText = document.getElementById("reply-preview-text");

  previewText.innerText = `Respondendo a @${user}: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`;
  previewBox.style.display = "flex";

  document.getElementById("message-input").focus();
}

// Cancela e fecha a barra de resposta
function cancelReply() {
  replyingTo = null;
  document.getElementById("reply-preview-box").style.display = "none";
}

// Abrir/Fechar Painel Principal
function toggleMonitorPanel() {
  const modal = document.getElementById("monitor-modal");
  if (modal.style.display === "none" || modal.style.display === "") {
    modal.style.display = "flex";
    socket.emit("get_monitored_list", { admin: currentUser });
  } else {
    modal.style.display = "none";
  }
}

// Receber a lista de monitorados do Servidor e montar os botões de ação
socket.on("monitored_list_response", (users) => {
  const container = document.getElementById("monitor-list-content");
  container.innerHTML = "";

  if (users.length === 0) {
    container.innerHTML = `<p style="color: #72767d; text-align: center; font-size: 0.9rem; padding: 10px;">Nenhum usuário sob investigação no momento.</p>`;
    return;
  }

  users.forEach((u) => {
    const div = document.createElement("div");
    div.className = "monitor-row";
    div.innerHTML = `
      <span style="font-weight: bold; color: #fff;">@${u.username}</span>
      <div style="display:flex; gap: 6px;">
         <button class="btn" style="background:#5865F2; padding: 5px 10px; font-size:0.8rem;" onclick="viewUserLogs('${u.username}')">📋 Ficha</button>
         <button class="btn" style="background:#ed4245; padding: 5px 10px; font-size:0.8rem;" onclick="stopMonitoring('${u.username}')">❌ Parar</button>
      </div>
    `;
    container.appendChild(div);
  });
});

// Ações disparadas pelos botões do painel
function stopMonitoring(targetUser) {
  if (confirm(`Remover @${targetUser} do monitoramento rigoroso?`)) {
    socket.emit("unmonitor_user", { admin: currentUser, target: targetUser });
  }
}

function viewUserLogs(targetUser) {
  socket.emit("get_user_behavior_logs", {
    admin: currentUser,
    target: targetUser,
  });
}

// Receber os registros minuciosos da IA e organizar por Linha do Tempo (Estilo WhatsApp)
socket.on("user_behavior_logs_response", (data) => {
  document.getElementById("behavior-title-name").innerText =
    `📋 Histórico e Notas da IA: @${data.target}`;
  const timeline = document.getElementById("behavior-timeline");
  timeline.innerHTML = "";

  if (data.logs.length === 0) {
    timeline.innerHTML = `<p style="color:#72767d; text-align:center; padding:20px;">Nenhuma mensagem capturada ou analisada ainda.</p>`;
    toggleModal("behavior-details-modal", true);
    return;
  }

  let lastDateGroup = "";

  data.logs.forEach((log) => {
    // Divisor de dia/mês/ano estilo WhatsApp
    if (log.date_group !== lastDateGroup) {
      lastDateGroup = log.date_group;
      const dateDivider = document.createElement("div");
      dateDivider.className = "timeline-date-divider";
      dateDivider.innerHTML = `<span>${log.date_group}</span>`;
      timeline.appendChild(dateDivider);
    }

    // Caixa da mensagem analisada com a cor baseada na infração
    const item = document.createElement("div");
    item.className = `log-item-box border-${log.severity}`;
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom: 5px; align-items: center;">
         <span style="color:#fff; font-size:0.85rem; font-weight:bold;">Mensagem capturada:</span>
         <span class="severity-badge severity-${log.severity}">${log.severity}</span>
      </div>
      <p style="color:#dcddde; font-size:0.95rem; background:#202225; padding:8px; border-radius:4px; margin-bottom:6px;">"${log.text}"</p>
      <div style="font-size:0.78rem; color:#b9bbbe;">
         <strong style="color:#faa61a;">🕵️ Nota da IA:</strong> ${log.reason}
      </div>
    `;
    timeline.appendChild(item);
  });

  toggleModal("behavior-details-modal", true);
});
