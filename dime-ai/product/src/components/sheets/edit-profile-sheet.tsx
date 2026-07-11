"use client";

import { useDimeApp } from "@/lib/store";
import { Avatar } from "@/components/avatar";
import { BottomSheet, SheetHeader } from "@/components/ui/sheet";
import { PillButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function EditProfileSheet() {
  const { state, dispatch } = useDimeApp();
  const showToast = useToast();

  const save = () => {
    if (state.saving) return;
    dispatch({ type: "SET_SAVING", value: true });
    setTimeout(() => {
      dispatch({ type: "SET_DISPLAY_NAME", name: state.editNameDraft.trim() || state.displayName });
      dispatch({ type: "SET_SAVING", value: false });
      dispatch({ type: "CLOSE_SHEETS" });
      showToast("Profile updated");
    }, 600);
  };

  return (
    <BottomSheet open={state.editOpen} onClose={() => dispatch({ type: "CLOSE_SHEETS" })} ariaLabel="Edit profile">
      <SheetHeader title="Edit profile" onClose={() => dispatch({ type: "CLOSE_SHEETS" })} />

      <div className="flex items-center gap-3 mb-5">
        <Avatar size={52} alt="" aria-hidden className="flex-none" />
        <button
          type="button"
          onClick={() => showToast("Photo upload is coming soon")}
          className="text-[13.5px] font-semibold text-mint"
        >
          Change photo
        </button>
      </div>

      <label className="block mb-4">
        <span className="block text-[12.5px] font-medium text-text-2 mb-1.5">Display name</span>
        <input
          value={state.editNameDraft}
          onChange={(e) => dispatch({ type: "SET_EDIT_DRAFT", draft: e.target.value })}
          className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[14.5px] text-text-1"
        />
      </label>

      <label className="block mb-5">
        <span className="block text-[12.5px] font-medium text-text-2 mb-1.5">Handle</span>
        <input value="@prez" readOnly className="w-full rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[14.5px] text-text-3" />
      </label>

      <div className="flex gap-2.5">
        <PillButton tone="outline" onClick={() => dispatch({ type: "CLOSE_SHEETS" })}>
          Cancel
        </PillButton>
        <PillButton tone="mint" onClick={save} disabled={state.saving}>
          {state.saving ? "Saving…" : "Save"}
        </PillButton>
      </div>
    </BottomSheet>
  );
}
