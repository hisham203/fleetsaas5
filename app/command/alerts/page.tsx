import { redirect } from "next/navigation";
// Alerts & Exceptions — planned for Milestone B. Redirect to Control Tower for now.
export default function AlertsPage() { redirect("/control-tower"); }
