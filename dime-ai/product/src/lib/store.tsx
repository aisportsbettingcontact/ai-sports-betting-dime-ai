"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type {
  AiChatMessage,
  ChatMessage,
  Conversation,
  CreditScenario,
  EffectiveCreditTier,
  Tab,
} from "@/lib/types";
import {
  CONVERSATIONS,
  DISPLAY_NAME,
  cannedConversation,
  matchDetailFor,
  pickResponse,
  type CannedResponse,
} from "@/lib/data/seed";
import { FEED_GAMES } from "@/lib/data/seed";
import { useToast } from "@/components/ui/toast";

const RESPONSE_COST = 40;
const STREAM_WORDS_PER_TICK = 2;
const STREAM_TICK_MS = 45;
const STREAM_SETTLE_MS = 350;
const SEND_DELAY_MS = 700;
const REGEN_DELAY_MS = 600;

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

interface AppState {
  tab: Tab;
  composerText: string;
  identityFaded: boolean;
  identityGone: boolean;
  messages: ChatMessage[];
  credits: number;
  scenario: CreditScenario;
  historyOpen: boolean;
  creditsOpen: boolean;
  membershipOpen: boolean;
  editOpen: boolean;
  logoutOpen: boolean;
  avatarMenuOpen: boolean;
  historyQuery: string;
  renamingId: string | null;
  renameDraft: string;
  confirmDeleteId: string | null;
  convos: Conversation[];
  currentConvoId: string;
  displayName: string;
  editNameDraft: string;
  saving: boolean;
  notifsOn: boolean;
  discordConnected: boolean;
  membershipCanceled: boolean;
  savedCount: number;
  scrolledUp: boolean;
  feedFilter: "all" | "mlb" | "nba" | "soccer";
  propsFilter: "all" | "high";
  propsTabWhy: Record<number, boolean>;
}

const initialState: AppState = {
  tab: "chat",
  composerText: "",
  identityFaded: false,
  identityGone: false,
  messages: [],
  credits: 2480,
  scenario: "live",
  historyOpen: false,
  creditsOpen: false,
  membershipOpen: false,
  editOpen: false,
  logoutOpen: false,
  avatarMenuOpen: false,
  historyQuery: "",
  renamingId: null,
  renameDraft: "",
  confirmDeleteId: null,
  convos: CONVERSATIONS,
  currentConvoId: "new",
  displayName: DISPLAY_NAME,
  editNameDraft: DISPLAY_NAME,
  saving: false,
  notifsOn: true,
  discordConnected: true,
  membershipCanceled: false,
  savedCount: 3,
  scrolledUp: false,
  feedFilter: "all",
  propsFilter: "all",
  propsTabWhy: {},
};

type Action =
  | { type: "SET_TAB"; tab: Tab }
  | { type: "SET_COMPOSER_TEXT"; text: string }
  | { type: "SET_IDENTITY"; faded?: boolean; gone?: boolean }
  | { type: "SET_MESSAGES"; messages: ChatMessage[]; convoId: string }
  | { type: "APPEND_USER_AND_THINKING"; userMsg: ChatMessage; aiMsg: AiChatMessage }
  | { type: "STREAM_TICK"; id: string; shownText: string }
  | { type: "STREAM_DONE"; id: string; response: CannedResponse; deduct: boolean }
  | { type: "STREAM_STOPPED"; ids: string[] }
  | { type: "REGEN_RESET"; id: string }
  | { type: "TOGGLE_EVIDENCE"; id: string }
  | { type: "TOGGLE_MSG_WHY"; id: string; index: number }
  | { type: "TOGGLE_SAVE"; id: string }
  | { type: "SET_SCROLLED_UP"; value: boolean }
  | { type: "SET_SCENARIO"; scenario: CreditScenario }
  | { type: "ADD_CREDITS"; amount: number }
  | { type: "OPEN_SHEET"; sheet: SheetName }
  | { type: "CLOSE_SHEETS" }
  | { type: "TOGGLE_AVATAR_MENU" }
  | { type: "CLOSE_AVATAR_MENU" }
  | { type: "SET_HISTORY_QUERY"; query: string }
  | { type: "START_RENAME"; id: string; draft: string }
  | { type: "SET_RENAME_DRAFT"; draft: string }
  | { type: "COMMIT_RENAME" }
  | { type: "ARM_DELETE"; id: string }
  | { type: "COMMIT_DELETE"; id: string }
  | { type: "SET_DISPLAY_NAME"; name: string }
  | { type: "SET_EDIT_DRAFT"; draft: string; opening?: boolean }
  | { type: "SET_SAVING"; value: boolean }
  | { type: "TOGGLE_NOTIFS" }
  | { type: "TOGGLE_DISCORD" }
  | { type: "TOGGLE_MEMBERSHIP_CANCELED" }
  | { type: "SET_FEED_FILTER"; filter: AppState["feedFilter"] }
  | { type: "SET_PROPS_FILTER"; filter: AppState["propsFilter"] }
  | { type: "TOGGLE_PROPS_TAB_WHY"; index: number };

type SheetName = "history" | "credits" | "membership" | "edit" | "logout";

function closeAllSheets(s: AppState): Partial<AppState> {
  return {
    historyOpen: false,
    creditsOpen: false,
    membershipOpen: false,
    editOpen: false,
    logoutOpen: false,
    renamingId: s.renamingId,
    confirmDeleteId: null,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, tab: action.tab };
    case "SET_COMPOSER_TEXT":
      return { ...state, composerText: action.text };
    case "SET_IDENTITY":
      return {
        ...state,
        identityFaded: action.faded ?? state.identityFaded,
        identityGone: action.gone ?? state.identityGone,
      };
    case "SET_MESSAGES":
      return {
        ...state,
        messages: action.messages,
        currentConvoId: action.convoId,
        tab: "chat",
        historyOpen: false,
        composerText: "",
        identityFaded: action.messages.length > 0,
        identityGone: action.messages.length > 0,
        convos: state.convos.map((c) => ({ ...c, current: c.id === action.convoId })),
      };
    case "APPEND_USER_AND_THINKING":
      return {
        ...state,
        messages: [...state.messages, action.userMsg, action.aiMsg],
        composerText: "",
        identityFaded: true,
        identityGone: true,
      };
    case "STREAM_TICK":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "ai" && m.id === action.id
            ? { ...m, status: "streaming", shownText: action.shownText }
            : m
        ),
      };
    case "STREAM_DONE": {
      const deducted = action.deduct ? Math.max(0, state.credits - RESPONSE_COST) : state.credits;
      return {
        ...state,
        credits: deducted,
        messages: state.messages.map((m) =>
          m.role === "ai" && m.id === action.id
            ? {
                ...m,
                status: "done",
                text: action.response.text,
                shownText: action.response.text,
                match: action.response.match,
                props: action.response.props,
                propsMeta: action.response.propsMeta,
                followups: action.response.followups,
                cost: RESPONSE_COST,
              }
            : m
        ),
      };
    }
    case "STREAM_STOPPED":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "ai" && action.ids.includes(m.id) ? { ...m, status: "stopped" } : m
        ),
      };
    case "REGEN_RESET":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "ai" && m.id === action.id
            ? {
                ...m,
                status: "thinking",
                shownText: "",
                match: undefined,
                props: undefined,
                propsMeta: undefined,
                followups: undefined,
              }
            : m
        ),
      };
    case "TOGGLE_EVIDENCE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "ai" && m.id === action.id ? { ...m, evidenceOpen: !m.evidenceOpen } : m
        ),
      };
    case "TOGGLE_MSG_WHY":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.role === "ai" && m.id === action.id
            ? { ...m, whyOpen: { ...m.whyOpen, [action.index]: !m.whyOpen[action.index] } }
            : m
        ),
      };
    case "TOGGLE_SAVE": {
      let delta = 0;
      const messages = state.messages.map((m) => {
        if (m.role === "ai" && m.id === action.id) {
          delta = m.saved ? -1 : 1;
          return { ...m, saved: !m.saved };
        }
        return m;
      });
      return { ...state, messages, savedCount: Math.max(0, state.savedCount + delta) };
    }
    case "SET_SCROLLED_UP":
      return { ...state, scrolledUp: action.value };
    case "SET_SCENARIO":
      return { ...state, scenario: action.scenario };
    case "ADD_CREDITS":
      return { ...state, credits: state.credits + action.amount, scenario: "live" };
    case "OPEN_SHEET":
      return {
        ...state,
        ...closeAllSheets(state),
        avatarMenuOpen: false,
        [`${action.sheet}Open`]: true,
      } as AppState;
    case "CLOSE_SHEETS":
      return { ...state, ...closeAllSheets(state) };
    case "TOGGLE_AVATAR_MENU":
      return { ...state, avatarMenuOpen: !state.avatarMenuOpen };
    case "CLOSE_AVATAR_MENU":
      return { ...state, avatarMenuOpen: false };
    case "SET_HISTORY_QUERY":
      return { ...state, historyQuery: action.query };
    case "START_RENAME":
      return { ...state, renamingId: action.id, renameDraft: action.draft, confirmDeleteId: null };
    case "SET_RENAME_DRAFT":
      return { ...state, renameDraft: action.draft };
    case "COMMIT_RENAME":
      return {
        ...state,
        convos: state.convos.map((c) =>
          c.id === state.renamingId ? { ...c, title: state.renameDraft.trim() || c.title } : c
        ),
        renamingId: null,
      };
    case "ARM_DELETE":
      return { ...state, confirmDeleteId: action.id, renamingId: null };
    case "COMMIT_DELETE":
      return {
        ...state,
        convos: state.convos.filter((c) => c.id !== action.id),
        confirmDeleteId: null,
      };
    case "SET_DISPLAY_NAME":
      return { ...state, displayName: action.name };
    case "SET_EDIT_DRAFT":
      return { ...state, editNameDraft: action.draft, ...(action.opening ? { editOpen: true } : {}) };
    case "SET_SAVING":
      return { ...state, saving: action.value };
    case "TOGGLE_NOTIFS":
      return { ...state, notifsOn: !state.notifsOn };
    case "TOGGLE_DISCORD":
      return { ...state, discordConnected: !state.discordConnected };
    case "TOGGLE_MEMBERSHIP_CANCELED":
      return { ...state, membershipCanceled: !state.membershipCanceled };
    case "SET_FEED_FILTER":
      return { ...state, feedFilter: action.filter };
    case "SET_PROPS_FILTER":
      return { ...state, propsFilter: action.filter, propsTabWhy: {} };
    case "TOGGLE_PROPS_TAB_WHY":
      return {
        ...state,
        propsTabWhy: { ...state.propsTabWhy, [action.index]: !state.propsTabWhy[action.index] },
      };
    default:
      return state;
  }
}

function emptyAiMessage(id: string): AiChatMessage {
  return {
    id,
    role: "ai",
    status: "thinking",
    text: "",
    shownText: "",
    evidenceOpen: false,
    whyOpen: {},
    saved: false,
    cost: RESPONSE_COST,
  };
}

/** Derives the effective credit tier used to render the credit pill / sheet. */
export function effectiveTier(scenario: CreditScenario, credits: number): EffectiveCreditTier {
  if (scenario === "unlimited") return "unlimited";
  if (scenario === "error") return "error";
  if (scenario === "low") return "low";
  if (scenario === "critical") return "critical";
  if (scenario === "zero") return "zero";
  if (credits <= 0) return "zero";
  if (credits <= 100) return "critical";
  if (credits <= 400) return "low";
  return "normal";
}

export function effectiveCredits(scenario: CreditScenario, credits: number): number {
  if (scenario === "low") return 180;
  if (scenario === "critical") return 25;
  if (scenario === "zero") return 0;
  return credits;
}

interface DimeApp {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  send: (text: string) => void;
  stopGen: () => void;
  regenerate: (id: string) => void;
  newChat: () => void;
  loadConvo: (id: string) => void;
  loadRecent: (title: string) => void;
  openMatchAnalysis: (gameId: string) => void;
  scrollRef: React.MutableRefObject<HTMLElement | null>;
}

const DimeAppContext = createContext<DimeApp | null>(null);

export function DimeAppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const showToast = useToast();
  const genTokenRef = useRef(0);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrolledUpRef = useRef(state.scrolledUp);
  const scenarioRef = useRef(state.scenario);

  useEffect(() => {
    scrolledUpRef.current = state.scrolledUp;
  }, [state.scrolledUp]);

  useEffect(() => {
    scenarioRef.current = state.scenario;
  }, [state.scenario]);

  const clearStreamTimer = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearStreamTimer, [clearStreamTimer]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const beginStream = useCallback(
    (msgId: string, response: CannedResponse, token: number) => {
      const words = response.text.split(" ");
      let revealed = 0;

      const tick = () => {
        if (genTokenRef.current !== token) return;
        revealed = Math.min(words.length, revealed + STREAM_WORDS_PER_TICK);
        const shownText = words.slice(0, revealed).join(" ");
        dispatch({ type: "STREAM_TICK", id: msgId, shownText });
        if (!scrolledUpRef.current) scrollToBottom();

        if (revealed < words.length) {
          streamTimerRef.current = setTimeout(tick, STREAM_TICK_MS);
        } else {
          streamTimerRef.current = setTimeout(() => {
            if (genTokenRef.current !== token) return;
            const deduct = scenarioRef.current !== "unlimited";
            dispatch({ type: "STREAM_DONE", id: msgId, response, deduct });
          }, STREAM_SETTLE_MS);
        }
      };

      streamTimerRef.current = setTimeout(tick, STREAM_TICK_MS);
    },
    [dispatch, scrollToBottom]
  );

  const send = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const eff = effectiveCredits(state.scenario, state.credits);
      if (eff < RESPONSE_COST && state.scenario !== "unlimited") {
        showToast("Not enough credits — add credits to continue");
        dispatch({ type: "OPEN_SHEET", sheet: "credits" });
        return;
      }

      const userMsg: ChatMessage = { id: nextId("u"), role: "user", text };
      const aiId = nextId("a");
      const aiMsg = emptyAiMessage(aiId);
      dispatch({ type: "APPEND_USER_AND_THINKING", userMsg, aiMsg });

      genTokenRef.current += 1;
      const token = genTokenRef.current;
      clearStreamTimer();
      streamTimerRef.current = setTimeout(() => {
        if (genTokenRef.current !== token) return;
        const response = pickResponse(text);
        beginStream(aiId, response, token);
      }, SEND_DELAY_MS);

      setTimeout(() => scrollToBottom(true), 0);
    },
    [state.scenario, state.credits, showToast, clearStreamTimer, beginStream, scrollToBottom]
  );

  const stopGen = useCallback(() => {
    genTokenRef.current += 1;
    clearStreamTimer();
    const ids = state.messages
      .filter((m): m is AiChatMessage => m.role === "ai" && (m.status === "thinking" || m.status === "streaming"))
      .map((m) => m.id);
    if (ids.length) dispatch({ type: "STREAM_STOPPED", ids });
  }, [state.messages, clearStreamTimer]);

  const regenerate = useCallback(
    (id: string) => {
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx < 1) return;
      const prevUser = state.messages[idx - 1];
      if (prevUser.role !== "user") return;
      dispatch({ type: "REGEN_RESET", id });
      genTokenRef.current += 1;
      const token = genTokenRef.current;
      clearStreamTimer();
      streamTimerRef.current = setTimeout(() => {
        if (genTokenRef.current !== token) return;
        const response = pickResponse(prevUser.text);
        beginStream(id, response, token);
      }, REGEN_DELAY_MS);
    },
    [state.messages, clearStreamTimer, beginStream]
  );

  const newChat = useCallback(() => {
    genTokenRef.current += 1;
    clearStreamTimer();
    dispatch({ type: "SET_MESSAGES", messages: [], convoId: "new" });
  }, [clearStreamTimer]);

  const loadConvo = useCallback(
    (id: string) => {
      const canned = cannedConversation(id);
      if (!canned) return;
      genTokenRef.current += 1;
      clearStreamTimer();
      const userMsg: ChatMessage = { id: nextId("u"), role: "user", text: canned.userText };
      const aiMsg: AiChatMessage = {
        ...emptyAiMessage(nextId("a")),
        status: "done",
        text: canned.ai.text,
        shownText: canned.ai.text,
        match: canned.ai.match,
        props: canned.ai.props,
        propsMeta: canned.ai.propsMeta,
        followups: canned.ai.followups,
      };
      dispatch({ type: "SET_MESSAGES", messages: [userMsg, aiMsg], convoId: id });
    },
    [clearStreamTimer]
  );

  const loadRecent = useCallback(
    (title: string) => {
      genTokenRef.current += 1;
      clearStreamTimer();
      const response = pickResponse(title);
      const userMsg: ChatMessage = { id: nextId("u"), role: "user", text: title };
      const aiMsg: AiChatMessage = {
        ...emptyAiMessage(nextId("a")),
        status: "done",
        text: response.text,
        shownText: response.text,
        match: response.match,
        props: response.props,
        propsMeta: response.propsMeta,
        followups: response.followups,
      };
      dispatch({ type: "SET_MESSAGES", messages: [userMsg, aiMsg], convoId: "recent" });
    },
    [clearStreamTimer]
  );

  const openMatchAnalysis = useCallback(
    (gameId: string) => {
      const game = FEED_GAMES.find((g) => g.id === gameId);
      if (!game) return;
      genTokenRef.current += 1;
      clearStreamTimer();
      const response = matchDetailFor(gameId);
      const userMsg: ChatMessage = {
        id: nextId("u"),
        role: "user",
        text: `Analyze ${game.away.name} vs ${game.home.name}`,
      };
      const aiMsg: AiChatMessage = {
        ...emptyAiMessage(nextId("a")),
        status: "done",
        text: response.text,
        shownText: response.text,
        match: response.match,
        props: response.props,
        propsMeta: response.propsMeta,
        followups: response.followups,
      };
      dispatch({ type: "SET_MESSAGES", messages: [userMsg, aiMsg], convoId: "feed" });
    },
    [clearStreamTimer]
  );

  const value: DimeApp = {
    state,
    dispatch,
    send,
    stopGen,
    regenerate,
    newChat,
    loadConvo,
    loadRecent,
    openMatchAnalysis,
    scrollRef,
  };

  return <DimeAppContext.Provider value={value}>{children}</DimeAppContext.Provider>;
}

export function useDimeApp() {
  const ctx = useContext(DimeAppContext);
  if (!ctx) throw new Error("useDimeApp must be used within DimeAppProvider");
  return ctx;
}
