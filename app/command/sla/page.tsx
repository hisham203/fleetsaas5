import { redirect } from "next/navigation";
// SLA Monitor — planned for Milestone B. Redirect to Reports for now.
export default function SlaPage() { redirect("/admin/reports"); }
