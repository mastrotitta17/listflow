import ResetPasswordPage from "@/components/ResetPasswordPage";
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Reset Password", "/reset-password");

export default function ResetPasswordRoute() {
  return <ResetPasswordPage />;
}
