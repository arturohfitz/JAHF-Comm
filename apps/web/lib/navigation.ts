import {
  BarChart3,
  CircleDollarSign,
  Headphones,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  WalletCards
} from "lucide-react";

export const mainNavigation = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard
  },
  {
    label: "Inbox",
    href: "/inbox",
    icon: Inbox
  },
  {
    label: "Contactos",
    href: "/contacts",
    icon: Users
  },
  {
    label: "Ventas",
    href: "/sales",
    icon: CircleDollarSign
  },
  {
    label: "Pagos",
    href: "/payments",
    icon: WalletCards
  },
  {
    label: "Soporte",
    href: "/support",
    icon: Headphones
  },
  {
    label: "Reportes",
    href: "/reports",
    icon: BarChart3
  },
  {
    label: "Configuracion",
    href: "/settings",
    icon: Settings
  }
] as const;
