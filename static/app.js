const state = {
    tasks: [],
    filter: "all",
    search: "",
    sortBy: "created_desc",
    editingTaskId: null,
};

// Priority weights for sorting
const priorityWeight = {
    High: 3,
    Medium: 2,
    Low: 1,
};

// DOM Elements
const taskListElement = document.getElementById("taskList");
const emptyStateElement = document.getElementById("emptyState");
const formErrorElement = document.getElementById("formError");
const taskInputElement = document.getElementById("taskInput");
const priorityInputElement = document.getElementById("priorityInput");
const dueDateInputElement = document.getElementById("dueDateInput");
const searchInputElement = document.getElementById("searchInput");
const sortSelectElement = document.getElementById("sortSelect");
const themeToggleElement = document.getElementById("themeToggle");

const totalCountElement = document.getElementById("totalCount");
const completedCountElement = document.getElementById("completedCount");
const activeCountElement = document.getElementById("activeCount");

// Utility Functions
function setFormError(message = "") {
    if (!message) {
        formErrorElement.classList.add("hidden");
        formErrorElement.textContent = "";
        return;
    }
    formErrorElement.textContent = message;
    formErrorElement.classList.remove("hidden");
}
// Theme Management
function applyTheme(theme) {
    document.body.dataset.theme = theme;
    const icon = themeToggleElement.querySelector("i");
    icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
}
// Initialize theme based on user preference or default to light
function initializeTheme() {
    const preferredTheme = localStorage.getItem("taskflow-theme") || "light";
    applyTheme(preferredTheme);
    themeToggleElement.addEventListener("click", () => {
        const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("taskflow-theme", nextTheme);
        applyTheme(nextTheme);
    });
}

async function parseResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || "Request failed.");
    }
    return payload;
}

async function fetchTasks() {
    try {
        const response = await fetch("/tasks", { credentials: "same-origin" });
        state.tasks = await parseResponse(response);
        render();
    } catch (error) {
        setFormError(error.message);
    }
}

// Task Management Functions
async function createTask() {
    const text = taskInputElement.value.trim();
    if (!text) {
        setFormError("Task text cannot be empty.");
        return;
    }

    const payload = {
        text,
        priority: priorityInputElement.value,
        due_date: dueDateInputElement.value,
    };

    try {
        setFormError("");
        const response = await fetch("/tasks", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const newTask = await parseResponse(response);
        state.tasks.unshift(newTask);
        taskInputElement.value = "";
        dueDateInputElement.value = "";
        priorityInputElement.value = "Medium";
        render();
    } catch (error) {
        setFormError(error.message);
    }
}

// Update task with partial updates
async function updateTask(taskId, updates) {
    const currentTask = state.tasks.find((task) => task.id === taskId);
    if (!currentTask) {
        return;
    }

    const payload = {
        text: updates.text ?? currentTask.text,
        completed: updates.completed ?? currentTask.completed,
        priority: updates.priority ?? currentTask.priority,
        due_date: updates.due_date ?? currentTask.due_date,
    };

    const response = await fetch(`/tasks/${taskId}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const updatedTask = await parseResponse(response);
    state.tasks = state.tasks.map((task) =>
        task.id === taskId ? updatedTask : task
    );
}

// Toggle task completion status
async function toggleTaskCompletion(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
        return;
    }

    try {
        await updateTask(taskId, { completed: !task.completed });
        render();
    } catch (error) {
        setFormError(error.message);
    }
}

async function removeTask(taskId) {
    try {
        const response = await fetch(`/tasks/${taskId}`, {
            method: "DELETE",
            credentials: "same-origin",
        });
        await parseResponse(response);
        state.tasks = state.tasks.filter((task) => task.id !== taskId);
        render();
    } catch (error) {
        setFormError(error.message);
    }
}

// Get tasks based on current filter, search, and sort criteria
function getVisibleTasks() {
    const query = state.search.toLowerCase().trim();

    return [...state.tasks]
        .filter((task) => {
            if (state.filter === "active") {
                return !task.completed;
            }
            if (state.filter === "completed") {
                return task.completed;
            }
            return true;
        })
        .filter((task) => task.text.toLowerCase().includes(query))
        .sort((a, b) => {
            if (state.sortBy === "priority_desc") {
                return priorityWeight[b.priority] - priorityWeight[a.priority];
            }
            if (state.sortBy === "due_asc") {
                if (!a.due_date && !b.due_date) {
                    return 0;
                }
                if (!a.due_date) {
                    return 1;
                }
                if (!b.due_date) {
                    return -1;
                }
                return a.due_date.localeCompare(b.due_date);
            }
            const first = a.created_at || "";
            const second = b.created_at || "";
            return second.localeCompare(first);
        });
}

function formatDueDate(dueDate) {
    if (!dueDate) {
        return "No due date";
    }

    const normalized = dueDate.includes("T") ? dueDate : `${dueDate}T00:00`;
    const parsedDate = new Date(normalized);

    if (Number.isNaN(parsedDate.getTime())) {
        return `Due ${dueDate}`;
    }

    return `Due ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(parsedDate)}`;
}

// Create a task card element based on the task data
function createTaskCard(task) {
    const isEditing = state.editingTaskId === task.id;
    const listItem = document.createElement("li");
    listItem.className = `task-card ${task.completed ? "completed" : ""}`;

    const priorityClass = (task.priority || "Medium").toLowerCase();
    const dueDate = formatDueDate(task.due_date);

    listItem.innerHTML = `
        <button class="icon-btn toggle-btn" aria-label="Toggle complete" title="Toggle complete">
            <i class="fa-solid ${task.completed ? "fa-circle-check" : "fa-circle"}"></i>
        </button>
        <div class="task-main">
            ${
                isEditing
                    ? `<input class="inline-input" type="text" value="${escapeHtml(task.text)}" maxlength="200">`
                    : `<p class="task-title">${escapeHtml(task.text)}</p>`
            }
            <div class="task-meta">
                <span class="badge ${priorityClass}">${task.priority}</span>
                <span><i class="fa-regular fa-calendar"></i> ${dueDate}</span>
            </div>
        </div>
        <div class="task-actions">
            <button class="ghost-btn edit-btn" type="button" title="Edit task">
                <i class="fa-solid ${isEditing ? "fa-floppy-disk" : "fa-pen"}"></i>
            </button>
            <button class="ghost-btn delete-btn" type="button" title="Delete task">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;

    const toggleButton = listItem.querySelector(".toggle-btn");
    const editButton = listItem.querySelector(".edit-btn");
    const deleteButton = listItem.querySelector(".delete-btn");

    toggleButton.addEventListener("click", () => {
        toggleTaskCompletion(task.id);
    });

    deleteButton.addEventListener("click", () => {
        removeTask(task.id);
    });

    editButton.addEventListener("click", async () => {
        if (!isEditing) {
            state.editingTaskId = task.id;
            render();
            return;
        }

        const inputElement = listItem.querySelector(".inline-input");
        const updatedText = inputElement.value.trim();
        if (!updatedText) {
            setFormError("Task text cannot be empty.");
            return;
        }

        try {
            await updateTask(task.id, { text: updatedText });
            state.editingTaskId = null;
            setFormError("");
            render();
        } catch (error) {
            setFormError(error.message);
        }
    });

    return listItem;
}

function updateCounters() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    totalCountElement.textContent = String(total);
    completedCountElement.textContent = String(completed);
    activeCountElement.textContent = String(total - completed);
}

function render() {
    const visibleTasks = getVisibleTasks();
    taskListElement.innerHTML = "";

    visibleTasks.forEach((task) => {
        taskListElement.appendChild(createTaskCard(task));
    });

    emptyStateElement.classList.toggle("hidden", visibleTasks.length > 0);
    updateCounters();
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// Setup event listeners for user interactions
function setupInteractions() {
    document.getElementById("addTaskBtn").addEventListener("click", createTask);
    taskInputElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            createTask();
        }
    });

    document.getElementById("filterGroup").addEventListener("click", (event) => {
        const target = event.target.closest("button[data-filter]");
        if (!target) {
            return;
        }

        state.filter = target.dataset.filter;
        document.querySelectorAll(".filter-btn").forEach((button) => {
            button.classList.toggle("active", button === target);
        });
        render();
    });

    // Search and sort interactions
    searchInputElement.addEventListener("input", (event) => {
        state.search = event.target.value;
        render();
    });

    sortSelectElement.addEventListener("change", (event) => {
        state.sortBy = event.target.value;
        render();
    });
}

initializeTheme();
setupInteractions();
fetchTasks();