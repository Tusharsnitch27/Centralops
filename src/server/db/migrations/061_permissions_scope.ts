// Permissions only cover AOP functions and S&OP streams now; program / project grants were never enforced.
export const sql = /* sql */ `
delete from permissions where entity_type not in ('aop_section','sop_stream');
`;
