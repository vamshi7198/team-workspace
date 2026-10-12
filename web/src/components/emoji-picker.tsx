"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EMOJIS = "📄 📝 📌 📎 📋 📁 📂 🗂️ 🗃️ 📚 📖 📒 📓 📔 📕 📗 📘 📙 🧾 📊 📈 📉 🗓️ 📅 ⏰ ✅ ☑️ ✔️ ❌ ⚠️ ❗ ❓ 💡 🔥 ⭐ 🌟 ✨ 🎯 🚀 🛠️ 🔧 ⚙️ 🧩 🧪 🔬 💻 🖥️ 📱 🌐 🔒 🔑 🛡️ 💰 💳 🧮 🏷️ 📦 🚚 🏭 🏢 🏠 🌱 🌍 🎨 🖌️ 🎬 🎤 📣 💬 🗣️ 👋 🤝 👥 🙋 🧑‍💻 🧠 ❤️ 💙 💚 💛 🟢 🟡 🔴 🔵 ⚖️ 🔁 🗺️ 🧭 🏁 🎉 🍕 ☕".split(" ");

export function EmojiPicker({ value, onChange, children, allowRemove = true }: { value: string | null; onChange: (v: string | null) => void; children: React.ReactNode; allowRemove?: boolean }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="mb-2 flex gap-2">
          <Input
            placeholder="Type or paste any emoji"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim()) pick(Array.from(custom.trim()).slice(0, 2).join(""));
            }}
            className="h-8"
          />
          {allowRemove && value && (
            <Button size="sm" variant="ghost" onClick={() => pick(null)}>
              Remove
            </Button>
          )}
        </div>
        <div className="grid max-h-56 grid-cols-10 gap-0.5 overflow-y-auto">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => pick(e)} className="flex size-7 items-center justify-center rounded text-lg hover:bg-accent" aria-label={`Use ${e}`}>
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
