import React, { useEffect, useState } from "react";
import { Assignment, Checklist, Report, User } from "../types";
import { styles } from "../styles/appStyles";
import DashboardShell from "../components/DashboardShell";
import PasswordInput from "../components/PasswordInput";
import ReportDetail from "../components/ReportDetail";
import { createAssignment, getAssignments } from "../services/assignmentService";
import {
  createChecklist,
  deleteChecklist,
  getChecklists,
} from "../services/checklistService";
import { deleteReport, getReports } from "../services/reportService";
import { getUsers } from "../services/userService";
import { generateChecklistPdf } from "../utils/generateChecklistPdf";

type Props = {
  user: User;
  onLogout: () => Promise<void>;
};

function mapReportToPdfPayload(report: Report) {
  return {
    hotelName: "Inspectria",
    reportTitle: "Checklist Completion Report",
    checklistTitle: report.checklistTitle,
    assignedToName: report.assignedToName,
    assignedByName: report.assignedByName,
    completedByName: report.completedByName,
    completedAt: report.completed_at,
    status: report.status,
    items: (report.items || []).map((item) => ({
      title: item.question,
      question: item.question,
      answer: item.answer as "YES" | "NO" | "N/A" | "",
      comment: item.comment || "",
      photos: item.photos || [],
      sectionTitle: item.sectionTitle || item.section_title || "",
    })),
  };
}

export default function AdminPage({ user, onLogout }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState([""]);
  const [selectedChecklistId, setSelectedChecklistId] = useState<number>(0);
  const [selectedUserId, setSelectedUserId] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");

  const load = async () => {
    const [u, c, a, r] = await Promise.all([
      getUsers(),
      getChecklists(),
      getAssignments(),
      getReports(),
    ]);

    setUsers(u);
    setChecklists(c);
    setAssignments(a);
    setReports(r);

    if (!selectedChecklistId && c[0]) {
      setSelectedChecklistId(c[0].id);
    }

    const assignableUsers = u.filter((x) => x.role === "user");
    if (!selectedUserId && assignableUsers[0]) {
      setSelectedUserId(assignableUsers[0].id);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addQuestion = () => {
    setQuestions((prev) => [...prev, ""]);
  };

  const updateQuestion = (index: number, value: string) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? value : q)));
  };

  const saveChecklist = async () => {
    setMessage("");
    setError("");

    const items = questions
      .map((q) => q.trim())
      .filter(Boolean)
      .map((question) => ({ question }));

    if (!title.trim() || items.length === 0) {
      setError("Checklist title and at least one question are required.");
      return;
    }

    try {
      await createChecklist(title.trim(), items);
      setTitle("");
      setQuestions([""]);
      setMessage("Checklist created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checklist could not be created");
    }
  };

  const assign = async () => {
    setMessage("");
    setError("");

    if (!selectedChecklistId || !selectedUserId) {
      setError("Checklist and user selection are required.");
      return;
    }

    try {
      await createAssignment(selectedChecklistId, selectedUserId);
      setMessage("Checklist assigned.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    }
  };

  const handleDownloadPdf = async (report: Report) => {
    const pdfPayload = mapReportToPdfPayload(report);
    await generateChecklistPdf(pdfPayload as any);
  };

  const handleCreateUser = async () => {
    setMessage("");
    setError("");

    if (!newUsername.trim() || !newPassword.trim() || !newName.trim()) {
      setError("Username, password and full name are required.");
      return;
    }

    const token = localStorage.getItem("mod_token");

    try {
      const res = await fetch("http://localhost:4000/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          name: newName.trim(),
          role: newRole,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || "User could not be created");
      }

      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRole("user");
      setMessage("User created successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be created");
    }
  };

  const handleDeleteUser = async (userId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm(
      "Are you sure you want to delete this user?"
    );

    if (!confirmDelete) return;

    const token = localStorage.getItem("mod_token");

    try {
      const res = await fetch(`http://localhost:4000/api/users/${userId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || "User could not be deleted");
      }

      setMessage("User deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be deleted");
    }
  };

  const handleDeleteTemplate = async (checklistId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm(
      "Are you sure you want to delete this template?"
    );

    if (!confirmDelete) return;

    try {
      await deleteChecklist(checklistId);
      setMessage("Template deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template could not be deleted");
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm(
      "Are you sure you want to delete this completed report?"
    );

    if (!confirmDelete) return;

    try {
      await deleteReport(reportId);
      setSelectedReport(null);
      setMessage("Report deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report could not be deleted");
    }
  };

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      {selectedReport ? (
        <div>
          <div style={{ ...styles.row, justifyContent: "space-between", marginBottom: 14 }}>
            <button
              style={styles.secondaryButton}
              onClick={() => setSelectedReport(null)}
            >
              Back
            </button>

            <div style={styles.row}>
              <button
                style={styles.button}
                onClick={() => handleDownloadPdf(selectedReport)}
              >
                Download PDF
              </button>
              <button
                style={styles.button}
                onClick={() => handleDeleteReport(selectedReport.id)}
              >
                Delete Report
              </button>
            </div>
          </div>

          <ReportDetail
            report={selectedReport}
            onBack={() => setSelectedReport(null)}
            onDownloadPdf={handleDownloadPdf}
          />
        </div>
      ) : (
        <>
          {message ? (
            <div style={{ ...styles.section, background: "#ecfeff", color: "#0f172a" }}>
              {message}
            </div>
          ) : null}

          {error ? (
            <div style={{ ...styles.section, background: "#fef2f2", color: "#991b1b" }}>
              {error}
            </div>
          ) : null}

          <div style={styles.section}>
            <h3 style={styles.title}>Create Checklist Template</h3>

            <input
              style={{ ...styles.input, marginBottom: 10 }}
              placeholder="Checklist title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {questions.map((q, index) => (
              <input
                key={index}
                style={{ ...styles.input, marginBottom: 8 }}
                placeholder={`Question ${index + 1}`}
                value={q}
                onChange={(e) => updateQuestion(index, e.target.value)}
              />
            ))}

            <div style={styles.row}>
              <button style={styles.secondaryButton} onClick={addQuestion}>
                Add Question
              </button>
              <button style={styles.button} onClick={saveChecklist}>
                Save Checklist
              </button>
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>Templates</h3>

            {checklists.length === 0 ? (
              <div style={styles.small}>No templates found.</div>
            ) : (
              checklists.map((c) => (
                <div key={c.id} style={styles.section}>
                  <strong>{c.title}</strong>
                  <br />
                  Created At: {"created_at" in c ? (c as any).created_at : "-"}
                  <br />
                  Questions: {Array.isArray((c as any).items) ? (c as any).items.length : 0}
                  <br />
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.button}
                      onClick={() => handleDeleteTemplate(c.id)}
                    >
                      Delete Template
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>Assignments</h3>

            <div style={{ ...styles.row, marginBottom: 12 }}>
              <select
                style={styles.input}
                value={selectedChecklistId}
                onChange={(e) => setSelectedChecklistId(Number(e.target.value))}
              >
                <option value={0}>Select checklist</option>
                {checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <select
                style={styles.input}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(Number(e.target.value))}
              >
                <option value={0}>Select user</option>
                {users
                  .filter((u) => u.role === "user")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>

              <button style={styles.button} onClick={assign}>
                Assign
              </button>
            </div>

            {assignments.map((a) => (
              <div key={a.id} style={styles.section}>
                <strong>{a.checklistTitle}</strong>
                <br />
                Assigned To: {a.assignedToName}
                <br />
                Assigned By: {a.assignedByName}
                <br />
                Status: {a.status}
              </div>
            ))}
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>User Management</h3>

            <div style={{ ...styles.row, marginBottom: 14 }}>
              <input
                style={styles.input}
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
              <PasswordInput
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Full Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <select
                style={styles.input}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>

              <button style={styles.button} onClick={handleCreateUser}>
                Create User
              </button>
            </div>

            {users.length === 0 ? (
              <div style={styles.small}>No users found.</div>
            ) : (
              users.map((u) => (
                <div key={u.id} style={styles.section}>
                  <strong>{u.name}</strong> ({u.username}) - {u.role}
                  <br />
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.button}
                      onClick={() => handleDeleteUser(u.id)}
                      disabled={u.id === user.id}
                    >
                      Delete User
                    </button>
                    {u.id === user.id ? (
                      <span style={{ fontSize: 12, color: "#6b7280" }}>
                        You cannot delete your own account
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>Completed Reports</h3>

            {reports.length === 0 ? (
              <div style={styles.small}>No reports yet.</div>
            ) : (
              reports.map((r) => (
                <div key={r.id} style={styles.section}>
                  <strong>{r.checklistTitle}</strong>
                  <br />
                  Completed By: {r.completedByName}
                  <br />
                  Assigned To: {r.assignedToName}
                  <br />
                  Status: {r.status}
                  <br />
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => setSelectedReport(r)}
                    >
                      View Detail
                    </button>

                    <button
                      style={styles.button}
                      onClick={() => handleDownloadPdf(r)}
                    >
                      Download PDF
                    </button>

                    <button
                      style={styles.button}
                      onClick={() => handleDeleteReport(r.id)}
                    >
                      Delete Report
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
