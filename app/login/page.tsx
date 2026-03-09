import AuthPage from "@/components/AuthPage";
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Login", "/login");

export default function LoginPage() {
  return <AuthPage standalone />;
}
