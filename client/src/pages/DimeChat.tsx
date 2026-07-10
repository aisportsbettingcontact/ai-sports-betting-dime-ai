/**
 * Dime AI — Chat page (module shim).
 * The implementation lives in ./dime-chat/DimeChatPage.tsx (frozen-design port:
 * design/frozen/dime-ai-home-{dark,light}.html). This re-export keeps the
 * App.tsx lazy import path (`./pages/DimeChat`) stable.
 */
export { default } from "./dime-chat/DimeChatPage";
