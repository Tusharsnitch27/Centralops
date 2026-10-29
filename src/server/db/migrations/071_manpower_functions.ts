// Productivity runs on the attendance app's functions (Inward, B2C/B2B Forward, B2C/B2B Return, Inventory; Admin/Ops/Logistics =
// Support). Names already pulled are mapped to the function of the same name; nothing a person has mapped is changed.
export const sql = /* sql */ `
update mp_func_map m set department = f.name
  from (values ('Inward'),('B2C Forward'),('B2B Forward'),('B2C Return'),('B2B Return'),('Inventory')) f(name)
 where m.department is null and lower(trim(m.func)) = lower(f.name);
update mp_func_map set department = 'Support'
 where department is null and lower(trim(func)) ~ '^(admin|ops|operations|logistics|security|housekeeping|hr|supervisor)';
`;
