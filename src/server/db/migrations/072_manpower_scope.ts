// Warehouse scope (29 Oct): Admin isn't counted; Ops (loading / unloading / housekeeping) + Logistics = "Ops & Logistics" overhead.
export const sql = /* sql */ `
update mp_func_map set department = null where lower(trim(func)) = 'admin' and department = 'Support';
update mp_func_map set department = 'Ops & Logistics' where department = 'Support';
`;
