import ctypes
import os
import sys
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from PIL import Image, ImageOps

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    HAS_DND = True
except Exception:
    HAS_DND = False


def enable_dpi_awareness():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PROCESS_SYSTEM_DPI_AWARE
        return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def _hex_to_colorref(hex_color):
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return (b << 16) | (g << 8) | r


def set_titlebar_color(root, bg_hex, text_hex):
    try:
        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        DWMWA_CAPTION_COLOR = 35
        DWMWA_TEXT_COLOR = 36
        bg_ref = ctypes.c_int(_hex_to_colorref(bg_hex))
        text_ref = ctypes.c_int(_hex_to_colorref(text_hex))
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, DWMWA_CAPTION_COLOR, ctypes.byref(bg_ref), ctypes.sizeof(bg_ref))
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, DWMWA_TEXT_COLOR, ctypes.byref(text_ref), ctypes.sizeof(text_ref))
    except Exception:
        pass


BG = "#F5F7FA"
CARD_BG = "#FFFFFF"
FIELD_BG = "#FFFFFF"
TROUGH = "#E6EAEF"
BORDER = "#D9DFE5"
ACCENT = "#2E8BE6"
ACCENT_ACTIVE = "#1E74C9"
ACCENT_DISABLED = "#A9CDEE"
ACCENT_HOVER = "#EAF3FC"
TEXT = "#1F2A37"
MUTED = "#57677A"

FONT = "맑은 고딕"


def apply_theme(root):
    root.configure(bg=BG)
    style = ttk.Style(root)
    style.theme_use("clam")

    style.configure(".", background=BG, foreground=TEXT, font=(FONT, 10))
    style.configure("TFrame", background=BG)
    style.configure("TLabel", background=BG, foreground=TEXT, font=(FONT, 10))
    style.configure("TLabelframe", background=BG, bordercolor=BORDER, borderwidth=1, relief="solid")
    style.configure("TLabelframe.Label", background=BG, foreground=TEXT, font=(FONT, 10, "bold"))

    style.configure("TButton", background=CARD_BG, foreground=TEXT, bordercolor=BORDER,
                     borderwidth=1, relief="solid", padding=(10, 6), focusthickness=0, font=(FONT, 10))
    style.map("TButton",
              background=[("pressed", TROUGH), ("active", ACCENT_HOVER), ("disabled", CARD_BG)],
              bordercolor=[("active", ACCENT)],
              foreground=[("disabled", MUTED)])

    style.configure("Accent.TButton", background=ACCENT, foreground="#FFFFFF", bordercolor=ACCENT,
                     borderwidth=0, relief="flat", padding=(14, 7), font=(FONT, 10, "bold"))
    style.map("Accent.TButton",
              background=[("pressed", ACCENT_ACTIVE), ("active", ACCENT_ACTIVE), ("disabled", ACCENT_DISABLED)])

    style.configure("TEntry", fieldbackground=FIELD_BG, foreground=TEXT, font=(FONT, 10),
                     bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER, padding=6)
    style.map("TEntry", bordercolor=[("focus", ACCENT)])

    style.configure("Horizontal.TScale", background=ACCENT, troughcolor=TROUGH,
                     bordercolor=ACCENT_ACTIVE, lightcolor=ACCENT, darkcolor=ACCENT,
                     sliderthickness=18, sliderlength=18)

    style.configure("Sky.Horizontal.TProgressbar", background=ACCENT, troughcolor=TROUGH,
                     bordercolor=BORDER, lightcolor=ACCENT, darkcolor=ACCENT)

    style.configure("Vertical.TScrollbar", background=CARD_BG, troughcolor=BG,
                     bordercolor=BORDER, arrowcolor=MUTED, relief="flat")


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
SAVE_FORMAT = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP",
               ".bmp": "JPEG", ".tif": "JPEG", ".tiff": "JPEG"}

QUALITY_MIN = 10
QUALITY_MAX = 95

QUALITY_PRESETS = [
    ("최고화질 90", 90),
    ("표준 60", 60),
    ("저용량 40", 40),
    ("최소용량 25", 25),
]


def default_output_dir():
    return os.path.join(os.path.expanduser("~"), "Downloads")


def quality_description(q):
    if q >= 80:
        return "고화질 위주 · 용량 절감은 적음"
    if q >= 55:
        return "화질과 용량의 균형 (권장)"
    if q >= 35:
        return "용량 우선 · 약간의 화질 저하"
    return "용량 최우선 · 화질 저하가 눈에 띔"


def human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def unique_path(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(f"{base}_{i}{ext}"):
        i += 1
    return f"{base}_{i}{ext}"


def compress_one(src_path, out_dir, quality):
    ext = os.path.splitext(src_path)[1].lower()
    fmt = SAVE_FORMAT.get(ext, "JPEG")

    img = Image.open(src_path)
    img = ImageOps.exif_transpose(img)

    if fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    elif fmt != "JPEG" and img.mode == "P":
        img = img.convert("RGBA")

    save_ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}[fmt]
    out_path = unique_path(os.path.join(out_dir, os.path.splitext(os.path.basename(src_path))[0] + save_ext))

    if fmt == "JPEG":
        img.save(out_path, "JPEG", quality=quality, optimize=True)
    elif fmt == "WEBP":
        img.save(out_path, "WEBP", quality=quality, method=6)
    else:  # PNG
        if quality < 100:
            colors = max(16, int(16 + quality * 2.4))
            img = img.convert("RGBA").quantize(colors=min(colors, 256), method=Image.FASTOCTREE)
        img.save(out_path, "PNG", optimize=True)

    return out_path


class ImageCompressorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("이미지 용량 압축기")
        self.root.geometry("760x820")
        self.root.minsize(680, 720)

        self.files = []  # list of source paths
        self.out_dir = tk.StringVar(value=default_output_dir())
        self.quality = tk.IntVar(value=60)
        self.msg_queue = queue.Queue()
        self.running = False
        self.preset_buttons = {}

        self._build_ui()
        self.root.after(100, self._poll_queue)

    def _build_ui(self):
        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)

        top = ttk.Frame(outer)
        top.pack(fill="x")
        ttk.Button(top, text="이미지 추가", command=self.add_files).pack(side="left")
        ttk.Button(top, text="폴더 추가", command=self.add_folder).pack(side="left", padx=(6, 0))
        ttk.Button(top, text="선택 삭제", command=self.remove_selected).pack(side="left", padx=(6, 0))
        ttk.Button(top, text="목록 지우기", command=self.clear_files).pack(side="left", padx=(6, 0))

        list_frame = ttk.Frame(outer)
        list_frame.pack(fill="both", expand=True, pady=(10, 4))
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side="right", fill="y")
        self.listbox = tk.Listbox(list_frame, selectmode="extended", height=6, font=(FONT, 10),
                                   yscrollcommand=scrollbar.set, borderwidth=1, relief="solid",
                                   highlightthickness=0, bg=FIELD_BG, fg=TEXT,
                                   selectbackground=ACCENT, selectforeground="#FFFFFF")
        self.listbox.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self.listbox.yview)

        if HAS_DND:
            self.listbox.drop_target_register(DND_FILES)
            self.listbox.dnd_bind("<<Drop>>", self.on_drop)
            hint = "이미지 파일이나 폴더를 여기로 드래그해도 됩니다"
        else:
            hint = "이미지 추가 / 폴더 추가 버튼으로 파일을 등록하세요"
        ttk.Label(outer, text=hint, foreground=MUTED).pack(anchor="w", pady=(0, 10))

        opt = ttk.LabelFrame(outer, text="압축 옵션", padding=12)
        opt.pack(fill="x")

        preset_row = ttk.Frame(opt)
        preset_row.pack(fill="x")
        for label, value in QUALITY_PRESETS:
            b = ttk.Button(preset_row, text=label, command=lambda v=value: self._set_quality(v))
            b.pack(side="left", padx=(0, 4), fill="x", expand=True)
            self.preset_buttons[value] = b

        qrow = ttk.Frame(opt)
        qrow.pack(fill="x", pady=(12, 2))
        ttk.Label(qrow, text="품질").pack(side="left")
        self.quality_label = ttk.Label(qrow, text="60", font=(FONT, 10, "bold"), foreground=ACCENT)
        self.quality_label.pack(side="right")

        srow = ttk.Frame(opt)
        srow.pack(fill="x")
        ttk.Label(srow, text=f"낮음 {QUALITY_MIN}", foreground=MUTED, font=(FONT, 9)).pack(side="left")
        scale = ttk.Scale(srow, from_=QUALITY_MIN, to=QUALITY_MAX, variable=self.quality, orient="horizontal",
                           command=self._on_quality_change, style="Horizontal.TScale")
        scale.pack(side="left", fill="x", expand=True, padx=8)
        ttk.Label(srow, text=f"높음 {QUALITY_MAX}", foreground=MUTED, font=(FONT, 9)).pack(side="left")

        self.quality_desc = ttk.Label(opt, text=quality_description(60), foreground=MUTED)
        self.quality_desc.pack(anchor="w", pady=(4, 12))

        orow = ttk.Frame(opt)
        orow.pack(fill="x")
        ttk.Label(orow, text="저장 폴더").pack(side="left")
        ttk.Entry(orow, textvariable=self.out_dir).pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(orow, text="찾아보기", command=self.choose_out_dir).pack(side="left")

        run_row = ttk.Frame(outer)
        run_row.pack(fill="x", pady=(12, 6))
        self.run_btn = ttk.Button(run_row, text="압축 시작", style="Accent.TButton",
                                   command=self.start_compress)
        self.run_btn.pack(side="left")
        self.open_btn = ttk.Button(run_row, text="폴더 열기", command=self.open_out_dir, state="disabled")
        self.open_btn.pack(side="left", padx=(6, 0))
        self.summary_label = ttk.Label(run_row, text="", font=(FONT, 9, "bold"))
        self.summary_label.pack(side="right")

        self.progress = ttk.Progressbar(outer, mode="determinate", style="Sky.Horizontal.TProgressbar")
        self.progress.pack(fill="x", pady=(0, 10))

        log_frame = ttk.LabelFrame(outer, text="진행 로그", padding=(8, 4))
        log_frame.pack(fill="both", expand=True)
        log_scroll = ttk.Scrollbar(log_frame)
        log_scroll.pack(side="right", fill="y")
        self.log = tk.Text(log_frame, height=6, yscrollcommand=log_scroll.set, state="disabled",
                            borderwidth=0, highlightthickness=0, bg=CARD_BG, fg=TEXT, font=(FONT, 10))
        self.log.pack(side="left", fill="both", expand=True)
        log_scroll.config(command=self.log.yview)

        self._refresh_preset_styles()

    def _on_quality_change(self, _evt=None):
        q = self.quality.get()
        self.quality_label.config(text=str(q))
        self.quality_desc.config(text=quality_description(q))
        self._refresh_preset_styles()

    def _refresh_preset_styles(self):
        q = self.quality.get()
        for value, btn in self.preset_buttons.items():
            btn.configure(style="Accent.TButton" if value == q else "TButton")

    def _set_quality(self, value):
        self.quality.set(value)
        self._on_quality_change()

    def on_drop(self, event):
        paths = self.root.tk.splitlist(event.data)
        for p in paths:
            if os.path.isdir(p):
                self._add_folder_path(p)
            elif os.path.splitext(p)[1].lower() in IMAGE_EXTS:
                self._add_file(p)

    def add_files(self):
        paths = filedialog.askopenfilenames(
            title="이미지 선택",
            filetypes=[("이미지 파일", "*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff")],
        )
        for p in paths:
            self._add_file(p)

    def add_folder(self):
        folder = filedialog.askdirectory(title="폴더 선택")
        if folder:
            self._add_folder_path(folder)

    def _add_folder_path(self, folder):
        for name in sorted(os.listdir(folder)):
            full = os.path.join(folder, name)
            if os.path.isfile(full) and os.path.splitext(name)[1].lower() in IMAGE_EXTS:
                self._add_file(full)

    def _add_file(self, path):
        if path in self.files:
            return
        self.files.append(path)
        size = os.path.getsize(path)
        self.listbox.insert("end", f"{os.path.basename(path)}  ({human_size(size)})")

    def remove_selected(self):
        sel = list(self.listbox.curselection())
        for idx in reversed(sel):
            self.listbox.delete(idx)
            del self.files[idx]

    def clear_files(self):
        self.listbox.delete(0, "end")
        self.files = []
        self.summary_label.config(text="")

    def choose_out_dir(self):
        folder = filedialog.askdirectory(title="저장 폴더 선택")
        if folder:
            self.out_dir.set(folder)

    def open_out_dir(self):
        path = self.out_dir.get()
        if os.path.isdir(path):
            os.startfile(path)

    def _log(self, text):
        self.log.config(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def start_compress(self):
        if self.running:
            return
        if not self.files:
            messagebox.showwarning("알림", "압축할 이미지를 먼저 추가하세요.")
            return
        out_dir = self.out_dir.get().strip()
        if not out_dir:
            messagebox.showwarning("알림", "저장 폴더를 지정하세요.")
            return
        os.makedirs(out_dir, exist_ok=True)

        self.running = True
        self.run_btn.config(state="disabled")
        self.open_btn.config(state="disabled")
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.config(state="disabled")
        self.summary_label.config(text="")
        self.progress.config(value=0, maximum=len(self.files))

        quality = self.quality.get()
        files = list(self.files)
        threading.Thread(target=self._compress_worker, args=(files, out_dir, quality), daemon=True).start()

    def _compress_worker(self, files, out_dir, quality):
        total_before = 0
        total_after = 0
        errors = 0
        for i, path in enumerate(files, start=1):
            try:
                before = os.path.getsize(path)
                out_path = compress_one(path, out_dir, quality)
                after = os.path.getsize(out_path)
                total_before += before
                total_after += after
                pct = (1 - after / before) * 100 if before else 0
                self.msg_queue.put(("log", f"{os.path.basename(path)}: {human_size(before)} → "
                                            f"{human_size(after)} ({pct:.0f}% 절감)"))
            except Exception as e:
                errors += 1
                self.msg_queue.put(("log", f"{os.path.basename(path)}: 실패 - {e}"))
            self.msg_queue.put(("progress", i))
        self.msg_queue.put(("done", (total_before, total_after, errors, out_dir)))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.msg_queue.get_nowait()
                if kind == "log":
                    self._log(payload)
                elif kind == "progress":
                    self.progress.config(value=payload)
                elif kind == "done":
                    self._on_done(*payload)
        except queue.Empty:
            pass
        self.root.after(100, self._poll_queue)

    def _on_done(self, total_before, total_after, errors, out_dir):
        self.running = False
        self.run_btn.config(state="normal")
        self.open_btn.config(state="normal")
        if total_before:
            pct = (1 - total_after / total_before) * 100
            self.summary_label.config(
                text=f"전체 {human_size(total_before)} → {human_size(total_after)} ({pct:.0f}% 절감)"
            )
        if errors:
            messagebox.showwarning("완료", f"압축이 끝났습니다. 실패 {errors}건이 있습니다.\n저장 위치: {out_dir}")
        else:
            messagebox.showinfo("완료", f"압축이 끝났습니다.\n저장 위치: {out_dir}")


def main():
    enable_dpi_awareness()
    root = TkinterDnD.Tk() if HAS_DND else tk.Tk()
    apply_theme(root)
    set_titlebar_color(root, ACCENT, "#FFFFFF")
    ImageCompressorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
