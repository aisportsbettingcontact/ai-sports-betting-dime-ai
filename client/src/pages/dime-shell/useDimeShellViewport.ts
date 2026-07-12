import { useEffect, useState } from "react";
import {
  DIME_SHELL_MEDIA_QUERY,
  matchesDimeShellViewport,
} from "./breakpoints";

export function useDimeShellViewport(): boolean {
  const [matches, setMatches] = useState(matchesDimeShellViewport);

  useEffect(() => {
    const query = window.matchMedia(DIME_SHELL_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return matches;
}
