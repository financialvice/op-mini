import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { BookTemplateIcon, DatabaseIcon, Home, UserIcon } from "lucide-react";
import Link from "next/link";

const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Templates",
    url: "/templates",
    icon: BookTemplateIcon,
  },
  {
    title: "Accounts",
    url: "/oauth",
    icon: UserIcon,
  },
  {
    title: "Databases",
    url: "/databases",
    icon: DatabaseIcon,
  },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
