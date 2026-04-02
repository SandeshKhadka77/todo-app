import os
import sqlite3
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

DATABASE_PATH = "database.db"
VALID_PRIORITIES = {"Low", "Medium", "High"}

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-change-me")

# Database helper functions
def get_db():
    """Create a connection with dict-like row access."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection

# Initialize the database schema and run forward-only migrations
def init_db():
    """Create base schema and run small forward-only migrations."""
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL DEFAULT 'Medium',
                due_date TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
            """
        )

        columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "due_date" not in columns:
            db.execute("ALTER TABLE tasks ADD COLUMN due_date TEXT")
        if "created_at" not in columns:
            db.execute(
                "ALTER TABLE tasks ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"
            )
        if "date" in columns:
            db.execute(
                "UPDATE tasks SET due_date = COALESCE(due_date, date)"
            )

# Authentication and utility decorators/functions
def login_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/tasks"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect("/")
        return view_func(*args, **kwargs)

    return wrapped_view


def normalize_priority(value):
    if value in VALID_PRIORITIES:
        return value
    return "Medium"


# Format a task row from the database into a dictionary for JSON responses
def format_task(task_row):
    return {
        "id": task_row["id"],
        "text": task_row["text"],
        "completed": bool(task_row["completed"]),
        "priority": task_row["priority"],
        "due_date": task_row["due_date"] or "",
        "created_at": task_row["created_at"] or "",
    }

# Routes
@app.route("/", methods=["GET", "POST"])
def login():
    if "user_id" in session:
        return redirect("/dashboard")

    error = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            error = "Username and password are required."
        else:
            with get_db() as db:
                user = db.execute(
                    "SELECT id, password FROM users WHERE username = ?",
                    (username,),
                ).fetchone()

# Check if user exists and password is correct
            if not user or not check_password_hash(user["password"], password):
                error = "Invalid username or password."
            else:
                session["user_id"] = user["id"]
                return redirect("/dashboard")

    return render_template("login.html", error=error)

# Registration route with validation and error handling
@app.route("/register", methods=["GET", "POST"])
def register():
    if "user_id" in session:
        return redirect("/dashboard")

    error = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if len(username) < 3:
            error = "Username must be at least 3 characters long."
        elif len(password) < 6:
            error = "Password must be at least 6 characters long."
        else:
            password_hash = generate_password_hash(password)
            try:
                with get_db() as db:
                    db.execute(
                        "INSERT INTO users (username, password) VALUES (?, ?)",
                        (username, password_hash),
                    )
                return redirect("/")
            except sqlite3.IntegrityError:
                error = "That username is already taken."

    return render_template("register.html", error=error)

# Dashboard route that requires login
@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@app.route("/tasks", methods=["GET"])
@login_required
def get_tasks():
    with get_db() as db:
        tasks = db.execute(
            """
            SELECT id, text, completed, priority, due_date, created_at
            FROM tasks
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (session["user_id"],),
        ).fetchall()

    return jsonify([format_task(task) for task in tasks])

# Create a new task with validation and error handling
@app.route("/tasks", methods=["POST"])
@login_required
def add_task():
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "").strip()
    priority = normalize_priority(payload.get("priority", "Medium"))
    due_date = (payload.get("due_date") or "").strip() or None

    if not text:
        return jsonify({"error": "Task text cannot be empty."}), 400

    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO tasks (user_id, text, completed, priority, due_date)
            VALUES (?, ?, 0, ?, ?)
            """,
            (session["user_id"], text, priority, due_date),
        )
        new_task_id = cursor.lastrowid
        task = db.execute(
            """
            SELECT id, text, completed, priority, due_date, created_at
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (new_task_id, session["user_id"]),
        ).fetchone()

    return jsonify(format_task(task)), 201

# Update an existing task with validation and error handling
@app.route("/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task(task_id):
    payload = request.get_json(silent=True) or {}

    with get_db() as db:
        existing_task = db.execute(
            "SELECT id, text, completed, priority, due_date FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, session["user_id"]),
        ).fetchone()

        if not existing_task:
            return jsonify({"error": "Task not found."}), 404

        updated_text = payload.get("text", existing_task["text"])
        updated_text = updated_text.strip() if isinstance(updated_text, str) else ""
        if not updated_text:
            return jsonify({"error": "Task text cannot be empty."}), 400

        completed_value = payload.get("completed", bool(existing_task["completed"]))
        updated_completed = 1 if bool(completed_value) else 0
        updated_priority = normalize_priority(
            payload.get("priority", existing_task["priority"])
        )
        due_date_value = payload.get("due_date", existing_task["due_date"])
        updated_due_date = (due_date_value or "").strip() or None

# Update the task in the database
        db.execute(
            """
            UPDATE tasks
            SET text = ?, completed = ?, priority = ?, due_date = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                updated_text,
                updated_completed,
                updated_priority,
                updated_due_date,
                task_id,
                session["user_id"],
            ),
        )
# Fetch the updated task to return in the response
        updated_task = db.execute(
            """
            SELECT id, text, completed, priority, due_date, created_at
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, session["user_id"]),
        ).fetchone()

    return jsonify(format_task(updated_task))

# Delete a task with error handling
@app.route("/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    with get_db() as db:
        result = db.execute(
            "DELETE FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, session["user_id"]),
        )

# Check if any row was deleted (if the task existed and belonged to the user)
    if result.rowcount == 0:
        return jsonify({"error": "Task not found."}), 404

    return jsonify({"status": "deleted"})

# Logout route to clear the session
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


init_db()


if __name__ == "__main__":
    app.run(debug=True)