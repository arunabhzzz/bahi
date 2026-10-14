import { Ledger } from "../packages/domain/src/ledger";
export function setup() {
  const l = new Ledger(":memory:"),
    t = l.session();
  const add = (k: string, d: any) => l.confirm(t, l.preview(t, k, d).id);
  const item = add("add_item", {
    name: "Sugar",
    unit: "kg",
    stock: 10000,
    price: 5000,
    cost: 4000,
    pack: 1000,
    leadDays: 1,
  });
  add("add_customer", { name: "Ramesh", balance: 0 });
  return { l, t, add, item };
}
