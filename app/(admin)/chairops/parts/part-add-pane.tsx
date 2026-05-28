// Right-pane "add" content for the parts split-view.
// Server Component wrapper · reuses the existing client form + createPart action.
import { NewPartForm } from "./new/new-part-form";

export function PartAddPane() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">เพิ่มอะไหล่ใหม่</h2>
        <p className="text-sm text-muted-foreground">
          กรอกข้อมูลอะไหล่ แล้วกดบันทึก
        </p>
      </div>
      <NewPartForm />
    </div>
  );
}
