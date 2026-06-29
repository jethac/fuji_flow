"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileQuestion,
  LinkIcon,
  Loader2,
  Mic,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AgentRunStatus,
  AgentRunView,
  ContextQuestion,
  TaskOutcome,
} from "@/lib/agent/types";
import type { ExtractedTask, SharpenQuestion } from "@/lib/task-intelligence";
import { isProviderLookupTask } from "@/lib/provider-lookup/intent";
import {
  TODO_STORAGE_KEY,
  createTodo,
  deleteTodo,
  loadTodos,
  saveTodos,
  updateTodo,
  type Todo,
} from "@/lib/todos";

type AgentCommand =
  | {
      action: "start";
      workflowKind?: "todo" | "provider_lookup";
      task: { taskId: string; title: string; notes?: string };
    }
  | {
      action: "answer_context";
      runId: string;
      answers: Record<string, string>;
      run?: AgentRunView;
    }
  | { action: "approve"; runId: string; run?: AgentRunView }
  | { action: "reject"; runId: string; reason?: string; run?: AgentRunView };

const starterTasks = [
  {
    title: "Outline a calm morning routine",
    notes: "Keep it realistic for weekdays and include a short checklist.",
  },
  {
    title: "Renew my passport",
    notes: "Find the official next steps and what materials I should gather.",
  },
  {
    title: "Draft a follow-up note for the design review",
    notes: "Tone should be concise, warm, and action-oriented.",
  },
];

const starterTodos: Todo[] = starterTasks.map((task, index) => ({
  id: `starter-${index + 1}`,
  title: task.title,
  notes: task.notes,
  completed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  questions: [],
}));

const statusCopy: Record<
  AgentRunStatus,
  { label: string; className: string; icon: typeof Clock3 }
> = {
  idle: {
    label: "Ready",
    className: "border-[#ead8c8] bg-[#f8efe5] text-[#6f5a4d]",
    icon: Clock3,
  },
  gathering_context: {
    label: "Context",
    className: "border-teal-200 bg-teal-50 text-teal-800",
    icon: FileQuestion,
  },
  planning: {
    label: "Planning",
    className: "border-amber-200 bg-[#fff0cf] text-amber-800",
    icon: Pencil,
  },
  awaiting_approval: {
    label: "Approval",
    className: "border-amber-300 bg-[#fff0cf] text-amber-900",
    icon: ShieldCheck,
  },
  executing: {
    label: "Running",
    className: "border-cyan-200 bg-cyan-50 text-cyan-800",
    icon: Loader2,
  },
  completed: {
    label: "Done",
    className: "border-[#c6d8c8] bg-[#edf6ef] text-[#42624a]",
    icon: CheckCircle2,
  },
  needs_user_action: {
    label: "Action",
    className: "border-[#f1c5ba] bg-[#fff1ee] text-[#9f3f31]",
    icon: AlertCircle,
  },
  error: {
    label: "Error",
    className: "border-[#f1c5ba] bg-[#fff1ee] text-[#9f3f31]",
    icon: AlertCircle,
  },
};

export function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>(starterTodos);
  const [runs, setRuns] = useState<Record<string, AgentRunView>>({});
  const [selectedId, setSelectedId] = useState<string>(starterTodos[0]?.id);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("Paste a task dump or record audio.");
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder>();
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, Record<string, string>>>({});
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = loadTodos(window.localStorage);

      if (stored.length > 0) {
        setTodos(stored);
        setSelectedId(stored[0]?.id);
      }

      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) {
      saveTodos(window.localStorage, todos);
    }
  }, [loaded, todos]);

  const selectedTodo = useMemo(
    () => todos.find((todo) => todo.id === selectedId) ?? todos[0],
    [selectedId, todos],
  );

  const selectedRun = selectedTodo?.agentRunId
    ? runs[selectedTodo.agentRunId]
    : undefined;

  const counts = useMemo(
    () => ({
      total: todos.length,
      done: todos.filter((todo) => todo.completed).length,
      active: todos.filter((todo) => !todo.completed).length,
    }),
    [todos],
  );

  function addTask() {
    if (!newTitle.trim()) return;
    const todo = createTodo({ title: newTitle, notes: newNotes });
    setTodos((current) => [todo, ...current]);
    setSelectedId(todo.id);
    setNewTitle("");
    setNewNotes("");
  }

  function addExtractedTask(task: ExtractedTask) {
    const todo = createTodo({
      title: task.title,
      notes: task.notes || task.sourceText,
    });
    setTodos((current) => [
      {
        ...todo,
        taskPatch: task.taskPatch,
        questions: (task.questions as SharpenQuestion[]).map((question) => ({
          ...question,
          taskId: todo.id,
        })),
      },
      ...current,
    ]);
    setSelectedId(todo.id);
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus("Recording is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordedChunks(chunks);
        await transcribeAudio(chunks);
      });
      recorder.start();
      setMediaRecorder(recorder);
      setRecordedChunks([]);
      setVoiceStatus("Recording. Stop when you are done.");
    } catch (caught) {
      setVoiceStatus(caught instanceof Error ? caught.message : "Could not start recording.");
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      setVoiceStatus("Transcribing audio...");
      mediaRecorder.stop();
    }
  }

  async function transcribeAudio(chunks = recordedChunks) {
    const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
    if (!blob.size) {
      setVoiceStatus("No audio was recorded.");
      return;
    }

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Transcription failed.");
      setVoiceText((current) => [current.trim(), payload.text].filter(Boolean).join("\n"));
      setVoiceStatus("Transcribed. Review, then add tasks.");
    } catch (caught) {
      setVoiceStatus(caught instanceof Error ? caught.message : "Transcription failed.");
    } finally {
      setMediaRecorder(undefined);
    }
  }

  async function addVoiceDumpTasks() {
    const text = voiceText.trim();
    if (!text) {
      setVoiceStatus("Paste or record a task dump first.");
      return;
    }

    setVoiceStatus("Extracting tasks with OpenAI...");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract", text }),
      });
      const payload = (await response.json()) as { tasks?: ExtractedTask[]; error?: string };
      if (!response.ok || !payload.tasks) throw new Error(payload.error || "Task extraction failed.");
      payload.tasks.forEach(addExtractedTask);
      setVoiceText("");
      setVoiceOpen(false);
      setVoiceStatus(`Added ${payload.tasks.length} task${payload.tasks.length === 1 ? "" : "s"}.`);
    } catch (caught) {
      setVoiceStatus(caught instanceof Error ? caught.message : "Task extraction failed.");
    }
  }

  function setTodoCompleted(todo: Todo, completed: boolean) {
    setTodos((current) => updateTodo(current, todo.id, { completed }));
  }

  function removeTodo(todo: Todo) {
    setTodos((current) => {
      const next = deleteTodo(current, todo.id);
      if (selectedId === todo.id) {
        setSelectedId(next[0]?.id);
      }
      return next;
    });
  }

  async function sendAgentCommand(command: AgentCommand) {
    setError(undefined);
    setBusyAction(command.action);
    try {
      const commandWithRun =
        "runId" in command && !command.run && runs[command.runId]
          ? { ...command, run: runs[command.runId] }
          : command;
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commandWithRun),
      });
      const payload = (await response.json()) as
        | { run: AgentRunView }
        | { error: string };

      if (!response.ok || !("run" in payload)) {
        throw new Error("error" in payload ? payload.error : "Agent request failed.");
      }

      setRuns((current) => ({
        ...current,
        [payload.run.id]: payload.run,
      }));

      if (payload.run.outcome?.status === "completed") {
        setTodos((current) =>
          updateTodo(current, payload.run.task.taskId, { completed: true }),
        );
      }

      return payload.run;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Agent request failed.";
      if ("runId" in command && message.includes("Agent run not found")) {
        clearStaleRun(command.runId);
        setError("That agent run expired after a server refresh. Start a new workflow for this task.");
      } else {
        setError(message);
      }
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  }

  function clearStaleRun(runId: string) {
    setRuns((current) => {
      const next = { ...current };
      delete next[runId];
      return next;
    });
    setTodos((current) =>
      current.map((todo) =>
        todo.agentRunId === runId
          ? { ...todo, agentRunId: undefined, updatedAt: new Date().toISOString() }
          : todo,
      ),
    );
    setAnswerDrafts((current) => {
      const next = { ...current };
      delete next[runId];
      return next;
    });
  }

  async function launchAgent(todo: Todo, workflowKind: "todo" | "provider_lookup" = "todo") {
    const run = await sendAgentCommand({
      action: "start",
      workflowKind,
      task: {
        taskId: todo.id,
        title: todo.title,
        notes: todo.notes,
      },
    });

    if (run) {
      setTodos((current) => updateTodo(current, todo.id, { agentRunId: run.id }));
    }
  }

  async function submitAnswers(run: AgentRunView) {
    const runAnswers = answerDrafts[run.id] ?? run.contextAnswers;

    await sendAgentCommand({
      action: "answer_context",
      runId: run.id,
      answers: runAnswers,
    });
  }

  async function approveRun(run: AgentRunView) {
    await sendAgentCommand({
      action: "approve",
      runId: run.id,
    });
  }

  async function rejectRun(run: AgentRunView) {
    await sendAgentCommand({
      action: "reject",
      runId: run.id,
      reason: "User rejected the proposed plan from the prototype UI.",
    });
  }

  const requiredAnswersComplete =
    selectedRun?.contextQuestions.every(
      (question) =>
        !question.required ||
        (answerDrafts[selectedRun.id]?.[question.id] ??
          selectedRun.contextAnswers[question.id] ??
          ""
        ).trim(),
    ) ?? false;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#ead8c8] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coral text-white shadow-sm shadow-[#c85f4b]/20">
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Fuji Flow</h1>
              <p className="text-sm text-[#6f5a4d]">
                {counts.active} active / {counts.done} done
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#ead8c8] bg-surface text-center shadow-sm shadow-[#8c5d45]/5 sm:min-w-72">
            <Metric label="Tasks" value={counts.total} />
            <Metric label="Active" value={counts.active} />
            <Metric label="Done" value={counts.done} />
          </div>
        </header>

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col gap-4">
            <div className="rounded-lg border border-[#ead8c8] bg-surface p-3 shadow-sm shadow-[#8c5d45]/5">
              <div className="flex gap-2">
                <input
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addTask();
                  }}
                  placeholder="New task"
                  className="h-11 min-w-0 flex-1 rounded-md border border-[#ead8c8] bg-[#fff8f1] px-3 text-sm text-foreground outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:bg-white focus:ring-2 focus:ring-[#c85f4b]/15"
                />
                <button
                  type="button"
                  onClick={addTask}
                  disabled={!newTitle.trim()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-coral text-white shadow-sm shadow-[#c85f4b]/20 transition hover:bg-coral-strong focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/25 disabled:cursor-not-allowed disabled:bg-[#d8b8aa] disabled:shadow-none"
                  aria-label="Add task"
                  title="Add task"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceOpen((open) => !open)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#ead8c8] bg-white text-[#6f5a4d] shadow-sm shadow-[#8c5d45]/5 transition hover:border-coral hover:text-coral focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/20"
                  aria-label="Voice dump"
                  title="Voice dump"
                >
                  <Mic className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <textarea
                value={newNotes}
                onChange={(event) => setNewNotes(event.target.value)}
                placeholder="Notes"
                className="mt-2 min-h-20 w-full resize-none rounded-md border border-[#ead8c8] bg-[#fff8f1] px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:bg-white focus:ring-2 focus:ring-[#c85f4b]/15"
              />
              {voiceOpen ? (
                <div className="mt-3 rounded-lg border border-[#ead8c8] bg-[#fff8f1] p-3">
                  <textarea
                    value={voiceText}
                    onChange={(event) => setVoiceText(event.target.value)}
                    placeholder="Paste or record a rough task dump"
                    className="min-h-28 w-full resize-none rounded-md border border-[#ead8c8] bg-white px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:ring-2 focus:ring-[#c85f4b]/15"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={mediaRecorder ? stopVoiceRecording : startVoiceRecording}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[#ead8c8] bg-white px-3 text-sm font-medium text-[#6f5a4d] transition hover:border-coral hover:text-coral"
                    >
                      {mediaRecorder ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Mic className="h-4 w-4" aria-hidden="true" />
                      )}
                      {mediaRecorder ? "Stop" : "Record"}
                    </button>
                    <button
                      type="button"
                      onClick={addVoiceDumpTasks}
                      disabled={!voiceText.trim()}
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-coral px-3 text-sm font-medium text-white shadow-sm shadow-[#c85f4b]/20 transition hover:bg-coral-strong disabled:cursor-not-allowed disabled:bg-[#d8b8aa] disabled:shadow-none"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add tasks
                    </button>
                    <span className="text-xs text-[#806b5e]">{voiceStatus}</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
              {todos.map((todo) => {
                const run = todo.agentRunId ? runs[todo.agentRunId] : undefined;
                const selected = selectedTodo?.id === todo.id;

                return (
                  <button
                    key={todo.id}
                    type="button"
                    onClick={() => setSelectedId(todo.id)}
                    className={`group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-surface p-3 text-left shadow-sm shadow-[#8c5d45]/5 transition hover:border-[#ddbca9] hover:shadow-md hover:shadow-[#8c5d45]/10 focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/20 ${
                      selected
                        ? "border-coral bg-white ring-2 ring-[#c85f4b]/15"
                        : "border-[#ead8c8]"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-md border ${
                        todo.completed
                          ? "border-sage bg-sage text-white"
                          : "border-[#dcc7b7] bg-[#fff8f1] text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm font-medium ${
                          todo.completed ? "text-[#8a7668] line-through" : "text-foreground"
                        }`}
                      >
                        {todo.title}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        {run ? <StatusPill status={run.status} /> : null}
                        {todo.notes ? (
                          <span className="truncate text-xs text-[#806b5e]">
                            {todo.notes}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 text-[#b69987] transition group-hover:text-coral"
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-h-[620px] overflow-hidden rounded-lg border border-[#ead8c8] bg-surface shadow-[0_18px_50px_rgba(117,74,51,0.08)]">
            {selectedTodo ? (
              <div className="grid h-full lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
                <div className="border-b border-[#ead8c8] p-5 lg:border-b-0 lg:border-r">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
                        Task
                      </p>
                      <textarea
                        value={selectedTodo.title}
                        onChange={(event) =>
                          setTodos((current) =>
                            updateTodo(current, selectedTodo.id, {
                              title: event.target.value,
                            }),
                          )
                        }
                        rows={2}
                        className="mt-2 min-h-16 w-full resize-none rounded-md border border-transparent bg-transparent text-xl font-semibold leading-7 text-foreground outline-none transition focus:border-[#ead8c8] focus:bg-[#fff8f1] focus:px-2 focus:py-1 focus:ring-2 focus:ring-[#c85f4b]/10"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setTodoCompleted(selectedTodo, !selectedTodo.completed)
                        }
                        className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
                          selectedTodo.completed
                            ? "border-[#c6d8c8] bg-[#edf6ef] text-[#42624a]"
                            : "border-[#ead8c8] bg-white text-[#6f5a4d] hover:border-[#c6d8c8] hover:text-[#42624a]"
                        }`}
                        aria-label="Toggle complete"
                        title="Toggle complete"
                      >
                        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTodo(selectedTodo)}
                        className="flex h-10 w-10 items-center justify-center rounded-md border border-[#ead8c8] bg-white text-[#8a7668] transition hover:border-[#f1c5ba] hover:text-[#9f3f31] focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/15"
                        aria-label="Delete task"
                        title="Delete task"
                      >
                        <Trash2 className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={selectedTodo.notes ?? ""}
                    onChange={(event) =>
                      setTodos((current) =>
                        updateTodo(current, selectedTodo.id, {
                          notes: event.target.value,
                        }),
                      )
                    }
                    placeholder="Notes"
                    className="mt-5 min-h-36 w-full resize-none rounded-lg border border-[#ead8c8] bg-[#fff8f1] px-3 py-3 text-sm leading-6 text-[#5f4d43] outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:bg-white focus:ring-2 focus:ring-[#c85f4b]/15"
                  />

                  <div className="mt-5 flex flex-wrap gap-2">
                    {selectedRun ? (
                      <StatusPill status={selectedRun.status} />
                    ) : (
                      <span className="rounded-full border border-[#ead8c8] bg-[#fff8f1] px-3 py-1 text-xs font-medium text-[#6f5a4d]">
                        No run
                      </span>
                    )}
                    {selectedRun ? (
                      <span className="rounded-full border border-[#ead8c8] bg-[#fff8f1] px-3 py-1 text-xs font-medium text-[#6f5a4d]">
                        {selectedRun.workflowKind === "provider_lookup"
                          ? "Provider lookup"
                          : "OpenAI SDK"}
                      </span>
                    ) : null}
                    {selectedTodo.completed ? (
                      <span className="rounded-full border border-[#c6d8c8] bg-[#edf6ef] px-3 py-1 text-xs font-medium text-[#42624a]">
                        Completed
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-6">
                    {!selectedRun ? (
                      <div className="flex flex-wrap gap-2">
                        {isProviderLookupTask(selectedTodo.title, selectedTodo.notes) ? (
                          <button
                            type="button"
                            onClick={() => launchAgent(selectedTodo, "provider_lookup")}
                            disabled={busyAction === "start"}
                            className="inline-flex h-11 items-center gap-2 rounded-md bg-sage px-4 text-sm font-medium text-white shadow-sm shadow-[#5f7f68]/20 transition hover:bg-[#4d6c56] focus:outline-none focus:ring-2 focus:ring-[#5f7f68]/25 disabled:cursor-wait disabled:bg-[#b9c5b8] disabled:shadow-none"
                          >
                            {busyAction === "start" ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Stethoscope className="h-4 w-4" aria-hidden="true" />
                            )}
                            Find provider
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => launchAgent(selectedTodo)}
                          disabled={busyAction === "start"}
                          className="inline-flex h-11 items-center gap-2 rounded-md bg-coral px-4 text-sm font-medium text-white shadow-sm shadow-[#c85f4b]/20 transition hover:bg-coral-strong focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/25 disabled:cursor-wait disabled:bg-[#d8b8aa] disabled:shadow-none"
                        >
                          {busyAction === "start" ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                          )}
                          Start agent
                        </button>
                      </div>
                    ) : (
                      <Timeline run={selectedRun} />
                    )}
                  </div>

                  {error ? (
                    <div className="mt-5 rounded-lg border border-[#f1c5ba] bg-red-soft px-3 py-3 text-sm text-[#9f3f31]">
                      {error}
                    </div>
                  ) : null}
                </div>

                <AgentPanel
                  run={selectedRun}
                  answers={
                    selectedRun
                      ? answerDrafts[selectedRun.id] ?? selectedRun.contextAnswers
                      : {}
                  }
                  setAnswer={(id, value) =>
                    selectedRun
                      ? setAnswerDrafts((current) => ({
                          ...current,
                          [selectedRun.id]: {
                            ...(current[selectedRun.id] ??
                              selectedRun.contextAnswers),
                            [id]: value,
                          },
                        }))
                      : undefined
                  }
                  canSubmitAnswers={requiredAnswersComplete}
                  busyAction={busyAction}
                  submitAnswers={submitAnswers}
                  approveRun={approveRun}
                  rejectRun={rejectRun}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-[#8a7668]">
                No task selected
              </div>
            )}
          </section>
        </div>
      </div>
      <span className="sr-only">{TODO_STORAGE_KEY}</span>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-[#ead8c8] px-4 py-3 last:border-r-0">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-[#8a7668]">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: AgentRunStatus }) {
  const meta = statusCopy[status];
  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm shadow-white/50 ${meta.className}`}
    >
      <Icon
        className={`h-3.5 w-3.5 ${status === "executing" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}

function Timeline({ run }: { run: AgentRunView }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
        Timeline
      </p>
      <ol className="mt-3 space-y-2">
        {run.timeline.map((event) => (
          <li key={event.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <span className="mt-1.5 h-2 w-2 rounded-full bg-coral" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {event.title}
              </span>
              <span className="block text-xs leading-5 text-[#806b5e]">
                {event.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgentPanel({
  run,
  answers,
  setAnswer,
  canSubmitAnswers,
  busyAction,
  submitAnswers,
  approveRun,
  rejectRun,
}: {
  run?: AgentRunView;
  answers: Record<string, string>;
  setAnswer: (id: string, value: string) => void;
  canSubmitAnswers: boolean;
  busyAction?: string;
  submitAnswers: (run: AgentRunView) => Promise<void>;
  approveRun: (run: AgentRunView) => Promise<void>;
  rejectRun: (run: AgentRunView) => Promise<void>;
}) {
  if (!run) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fff8f1] p-8 text-center">
        <div>
          <Sparkles className="mx-auto h-8 w-8 text-coral" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[#6f5a4d]">Agent idle</p>
        </div>
      </div>
    );
  }

  const hasOutcome = Boolean(run.outcome);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fff8f1]">
      <div className="border-b border-[#ead8c8] bg-surface px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
              Agent
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              {statusCopy[run.status].label}
            </h2>
          </div>
          <StatusPill status={run.status} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <LatestUpdate run={run} />

        {run.outcome ? <OutcomePanel outcome={run.outcome} /> : null}

        {run.status === "gathering_context" ? (
          <ContextForm
            questions={run.contextQuestions}
            answers={answers}
            setAnswer={setAnswer}
            disabled={busyAction === "answer_context"}
            canSubmit={canSubmitAnswers}
            onSubmit={() => submitAnswers(run)}
          />
        ) : null}

        {run.plan ? (
          <PlanPanel
            run={run}
            busyAction={busyAction}
            approveRun={approveRun}
            rejectRun={rejectRun}
            supporting={hasOutcome}
          />
        ) : null}

        {run.error ? (
          <div className="rounded-lg border border-[#f1c5ba] bg-red-soft p-4 text-sm text-[#9f3f31]">
            {run.error}
          </div>
        ) : null}

        {run.status === "planning" || run.status === "executing" ? (
          <div className="flex items-center gap-3 rounded-lg border border-[#ead8c8] bg-surface p-4 text-sm text-[#6f5a4d] shadow-sm shadow-[#8c5d45]/5">
            <Loader2 className="h-4 w-4 animate-spin text-coral" aria-hidden="true" />
            Working
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LatestUpdate({ run }: { run: AgentRunView }) {
  const latestEvent = run.timeline.at(-1);
  const updateText = latestEvent
    ? `${latestEvent.title}: ${latestEvent.body}`
    : "Ready to start.";

  return (
    <div className="mb-5 rounded-lg border border-[#ead8c8] bg-surface p-4 shadow-sm shadow-[#8c5d45]/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
          Latest update
        </p>
        <StatusPill status={run.status} />
      </div>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">
        {updateText}
      </p>
    </div>
  );
}

function ContextForm({
  questions,
  answers,
  setAnswer,
  disabled,
  canSubmit,
  onSubmit,
}: {
  questions: ContextQuestion[];
  answers: Record<string, string>;
  setAnswer: (id: string, value: string) => void;
  disabled: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#ead8c8] bg-surface p-4 shadow-sm shadow-[#8c5d45]/5">
      <h3 className="text-sm font-semibold text-foreground">Context</h3>
      <div className="mt-4 space-y-4">
        {questions.map((question) => (
          <label key={question.id} className="block">
            <span className="text-sm font-medium text-[#4d3d35]">
              {question.label}
            </span>
            {question.helpText ? (
              <span className="mt-1 block text-xs leading-5 text-[#806b5e]">
                {question.helpText}
              </span>
            ) : null}
            {question.type === "long" ? (
              <textarea
                value={answers[question.id] ?? ""}
                onChange={(event) => setAnswer(question.id, event.target.value)}
                placeholder={question.placeholder}
                className="mt-2 min-h-24 w-full resize-none rounded-md border border-[#ead8c8] bg-[#fff8f1] px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:bg-white focus:ring-2 focus:ring-[#c85f4b]/15"
              />
            ) : (
              <input
                value={answers[question.id] ?? ""}
                type={question.type === "date" ? "text" : question.type}
                onChange={(event) => setAnswer(question.id, event.target.value)}
                placeholder={question.placeholder}
                className="mt-2 h-10 w-full rounded-md border border-[#ead8c8] bg-[#fff8f1] px-3 text-sm text-foreground outline-none transition placeholder:text-[#a58b7a] focus:border-coral focus:bg-white focus:ring-2 focus:ring-[#c85f4b]/15"
              />
            )}
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || disabled}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-medium text-white shadow-sm shadow-[#c85f4b]/20 transition hover:bg-coral-strong focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/25 disabled:cursor-not-allowed disabled:bg-[#d8b8aa] disabled:shadow-none"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-4 w-4" aria-hidden="true" />
        )}
        Submit context
      </button>
    </div>
  );
}

function PlanPanel({
  run,
  busyAction,
  approveRun,
  rejectRun,
  supporting = false,
}: {
  run: AgentRunView;
  busyAction?: string;
  approveRun: (run: AgentRunView) => Promise<void>;
  rejectRun: (run: AgentRunView) => Promise<void>;
  supporting?: boolean;
}) {
  if (!run.plan) return null;

  return (
    <div className="mb-5 rounded-lg border border-[#ead8c8] bg-surface p-4 shadow-sm shadow-[#8c5d45]/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Plan</h3>
          {supporting ? (
            <p className="mt-1 text-xs font-medium uppercase tracking-widest text-[#8a7668]">
              Supporting context
            </p>
          ) : null}
          <p className="mt-1 text-sm leading-6 text-[#5f4d43]">{run.plan.summary}</p>
        </div>
        <span className="rounded-full border border-[#ead8c8] bg-[#fff8f1] px-2.5 py-1 text-xs font-medium text-[#6f5a4d]">
          {run.plan.estimatedEffort}
        </span>
      </div>

      <ol className="mt-4 space-y-3">
        {run.plan.steps.map((step, index) => (
          <li key={step.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#f8efe5] text-xs font-semibold text-coral">
              {index + 1}
            </span>
            <span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {step.title}
                </span>
                <span className="rounded-full bg-[#edf6ef] px-2 py-0.5 text-[11px] font-medium uppercase text-[#42624a]">
                  {step.owner}
                </span>
              </span>
              <span className="mt-1 block text-sm leading-6 text-[#5f4d43]">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {run.status === "awaiting_approval" ? (
        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-soft p-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-800" aria-hidden="true" />
            <p className="text-sm leading-6 text-amber-950">
              {run.approvalRequest?.statement}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => approveRun(run)}
              disabled={busyAction === "approve"}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-medium text-white shadow-sm shadow-[#c85f4b]/20 transition hover:bg-coral-strong focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/25 disabled:cursor-wait disabled:bg-[#d8b8aa] disabled:shadow-none"
            >
              {busyAction === "approve" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Approve
            </button>
            <button
              type="button"
              onClick={() => rejectRun(run)}
              disabled={busyAction === "reject"}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#ead8c8] bg-white px-4 text-sm font-medium text-[#6f5a4d] transition hover:border-[#f1c5ba] hover:text-[#9f3f31] focus:outline-none focus:ring-2 focus:ring-[#c85f4b]/15 disabled:cursor-wait disabled:text-[#b8a497]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Reject
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutcomePanel({ outcome }: { outcome: TaskOutcome }) {
  return (
    <div className="mb-5 rounded-lg border border-[#ead8c8] bg-surface p-4 shadow-sm shadow-[#8c5d45]/5">
      <div className="flex items-start gap-3">
        {outcome.status === "completed" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-sage" aria-hidden="true" />
        ) : (
          <AlertCircle className="mt-0.5 h-5 w-5 text-[#9f3f31]" aria-hidden="true" />
        )}
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {outcome.status === "completed" ? "Result" : "Action needed"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#5f4d43]">{outcome.summary}</p>
        </div>
      </div>

      {outcome.completedActions.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
            Completed
          </p>
          <ul className="mt-2 space-y-2">
            {outcome.completedActions.map((action) => (
              <li key={action} className="flex gap-2 text-sm text-[#5f4d43]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {outcome.nextSteps.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
            Actions
          </p>
          <div className="mt-2 space-y-3">
            {outcome.nextSteps.map((step) => (
              <div
                key={`${step.title}-${step.detail}`}
                className="rounded-lg border border-[#ead8c8] bg-[#fff8f1] p-3"
              >
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-[#5f4d43]">{step.detail}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {step.link ? (
                    <a
                      href={step.link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-[#ead8c8] bg-white px-2.5 py-1 text-xs font-medium text-[#6f5a4d] transition hover:border-coral hover:text-coral"
                    >
                      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      Link
                    </a>
                  ) : null}
                  {step.phone ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#ead8c8] bg-white px-2.5 py-1 text-xs font-medium text-[#6f5a4d]">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      {step.phone}
                    </span>
                  ) : null}
                  {step.deadline ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#ead8c8] bg-white px-2.5 py-1 text-xs font-medium text-[#6f5a4d]">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {step.deadline}
                    </span>
                  ) : null}
                </div>
                {step.materials?.length ? (
                  <p className="mt-2 text-xs leading-5 text-[#806b5e]">
                    Materials: {step.materials.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {outcome.citations.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8a7668]">
            Links
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {outcome.citations.map((citation) => (
              <a
                key={citation.url}
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[#ead8c8] bg-[#fff8f1] px-3 py-1 text-xs font-medium text-[#6f5a4d] transition hover:border-coral hover:text-coral"
              >
                <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {citation.title}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
