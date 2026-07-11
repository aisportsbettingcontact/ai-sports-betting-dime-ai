import { ToastProvider } from "@/components/ui/toast";
import { DimeAppProvider } from "@/lib/store";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <ToastProvider>
      <DimeAppProvider>
        <AppShell />
      </DimeAppProvider>
    </ToastProvider>
  );
}
