/** Programs that have a dedicated planning module. */
export const moduleLink = (code: string | null) =>
  code === "COST" ? { href: "/aop", label: "AOP cost plan" } : code === "SOP" ? { href: "/sop", label: "S&OP plan" } : null;
