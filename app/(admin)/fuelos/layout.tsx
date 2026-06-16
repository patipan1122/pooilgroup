// FuelOS layout — ตั้งชื่อแท็บเบราว์เซอร์ให้แยกออกจากโปรแกรมอื่น
// (gate การเข้าถึงทำที่ (admin) layout ชั้นบนอยู่แล้ว · ตัวนี้แค่ตั้ง title)
export const metadata = { title: "FuelOS น้ำมัน" };

export default function FuelOsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
