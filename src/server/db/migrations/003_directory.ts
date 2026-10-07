// Team directory fields: employee number and department (Central Operations org chart).
export const sql = /* sql */ `
alter table users add column if not exists employee_no text;
alter table users add column if not exists department text;
create unique index if not exists users_employee_no on users(employee_no) where employee_no is not null;
`;
