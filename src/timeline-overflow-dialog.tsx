import { createPortal } from "react-dom";
import { ConfirmationDialog } from "./feedback";
import "./timeline-overflow.css";

export function TimelineOverflowDialog({ members, onLocate, onClose }: {
  members: {key: string; title: string; time: string}[];
  onLocate: (key: string) => void;
  onClose: () => void;
}) {
  return createPortal(<div className="dialog-backdrop timeline-overflow-dialog" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <ConfirmationDialog aria-labelledby="timeline-overflow-title" initialFocus=".timeline-overflow-members button" onCancel={onClose}>
      <h2 id="timeline-overflow-title">同段收起的任务</h2>
      <div className="confirmation-body"><p>选择一项，在时间线上定位。</p>
        <div className="timeline-overflow-members">{members.map(member => <button type="button" key={member.key} data-timeline-key={member.key} onClick={() => onLocate(member.key)}>
          <strong>{member.title}</strong><small>{member.time}</small>
        </button>)}</div>
      </div>
      <div className="dialog-actions"><button type="button" onClick={onClose}>关闭</button></div>
    </ConfirmationDialog>
  </div>, document.body);
}
