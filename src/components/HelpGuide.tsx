type Props = {
  open: boolean;
  quizName: string;
  onClose: () => void;
};

export default function HelpGuide({ open, quizName, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-slate-900/20 p-3"
      onClick={onClose}
    >
      <div
        className="panel-scroll max-h-[85%] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-slate-900">使用说明</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 text-xs leading-5 text-slate-600">
          <section>
            <div className="mb-1 font-medium text-slate-800">打开与关闭</div>
            <p>
              App 在屏幕<strong>顶部菜单栏</strong>，不在 Dock。点图标打开任务面板；取消固定后点击其他窗口会隐藏面板。设置里可「退出」完全关闭。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">首次使用</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>设置 → 选择资料目录（如 Desktop/系规）</li>
              <li>设置 → 选择教材 PDF（官方带书签版）</li>
              <li>设置 → 选择三色笔记文件夹（每章一个 PDF）</li>
            </ol>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">课程按钮</div>
            <ul className="space-y-1">
              <li>
                <span className="font-medium text-blue-600">▶ 播放</span>
                ：内置播放器续播
              </li>
              <li>
                <span className="font-medium text-amber-600">书</span>
                ：点击「书」选官方教材（Preview 跳页）或三色笔记（按章打开 PDF；导学课无对应章节）
              </li>
              <li>
                <span className="font-medium text-emerald-600">题</span>
                ：复制小程序链接并打开微信（{quizName}）
              </li>
            </ul>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">教材跳页</div>
            <p>
              需在「系统设置 → 隐私与安全性 → 辅助功能」中允许<strong>系规助手</strong>。修改后请完全退出并重新打开 App。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">更新视频</div>
            <p>
              把新视频放进对应文件夹（基础课 <code className="text-[11px]">01：…</code>，专题{" "}
              <code className="text-[11px]">02：…</code>），文件名保持{" "}
              <code className="text-[11px]">[编号]--标题.mp4</code>，然后在终端执行：
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              cd ~/Projects/xigui-pilot && pnpm gen:plan && ./scripts/update-desktop-app.sh
            </p>
            <p className="mt-1">
              已有观看进度按<strong>课节编号</strong>保存，编号不变的课进度会保留；专题课使用
              901 起的内部编号（界面显示为「专01」）。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">桌面悬浮字幕</div>
            <p>
              开启后，播放时会查找与视频<strong>同目录、同名</strong>的{" "}
              <code className="text-[11px]">.srt</code> 或{" "}
              <code className="text-[11px]">.vtt</code> 文件。例如视频为{" "}
              <code className="text-[11px]">[01]--导学.mp4</code>，字幕应为{" "}
              <code className="text-[11px]">[01]--导学.srt</code>。字幕条可拖到桌面任意位置。
              设置里可切换<strong>猫猫模式</strong>：像素奶牛猫常驻（开机自启后面板起来就会出现）。暂停/关视频时休息、不说话；播放中安静陪伴；只有开启悬浮字幕且当前有字幕句时才冒气泡。靠屏幕右侧时气泡会自动翻到左边。
            </p>
            <p className="mt-1">
              <strong>护眼</strong>（20-20-20）：播放时仍由播放器提醒，休息盖住播放窗口；没在播放时由猫走表，剩余约 5
              分钟起显示状态条预告，到点用气泡催促。开始播 / 停播会换宿主并重新计时。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">开发调试（改界面不用每次打包）</div>
            <p>
              在终端运行 <code className="text-[11px]">pnpm dev:app</code>{" "}
              启动带热更新的开发版，改 <code className="text-[11px]">src/</code>{" "}
              保存即可刷新。只有改 Rust 后端才需重启。日常用再执行打包脚本。
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              cd ~/Projects/xigui-pilot && pnpm dev:app
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">更新 App</div>
            <p className="font-mono text-[11px] text-slate-500">
              cd ~/Projects/xigui-pilot && ./scripts/update-desktop-app.sh
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
