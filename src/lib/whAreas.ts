// Warehouse areas by category (capacity is set per area: S&OP › Monthly review › Warehouse utilisation › capacity control).
// Pre-packs are not a category: a pre-pack is a set of any category's pieces, and always sits in the pre-pack area (counted as packs).

/** Non-apparel categories that sit in the pre-pack area with the pre-packs. */
export const PREPACK_AREA_CATEGORIES = ["Accessories", "Bags", "Belts", "Caps", "Perfumes", "Shoes", "Socks", "Sunglasses", "Trolley"];
/** Apparel categories in the main warehouse area (any category not listed above also counts here). */
export const WAREHOUSE_CATEGORIES = ["Blazers", "Cargo Pants", "Chinos", "Co_Ords_Plus", "Hoodies", "Innerwear", "Jackets", "Jeans", "Joggers & Trackpants",
  "Overshirt", "Shirts", "Shorts", "Sweaters", "Sweatshirts", "T-Shirts", "Trousers"];

/** Snowflake REGEXP_LIKE pattern for a pre-pack area category / item name (whole words, singular or plural; footwear = shoes). */
export const PREPACK_AREA_REGEX = ".*(^|[^a-z])(accessor(y|ies)|bags?|belts?|caps?|perfumes?|shoes?|footwear|socks?|sunglass(es)?|trolley(s)?)([^a-z]|$).*";

/** One name per category across the sheet, the workbook and Snowflake (Sweater = Sweaters, Footwear = Shoes, …). */
const ALIAS: Record<string, string> = { sweater: "Sweaters", footwear: "Shoes", "shoes/footwear": "Shoes", accessories: "Accessories", belt: "Belts", trouser: "Trousers",
  "t-shirt": "T-Shirts", shirt: "Shirts", jacket: "Jackets", cargo: "Cargo Pants", "joggers/trackpnats": "Joggers & Trackpants" };
export const categoryName = (label: string) => ALIAS[label.trim().toLowerCase()] ?? label.trim();
