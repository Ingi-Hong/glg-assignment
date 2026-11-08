import { Chance } from 'chance';

export interface OrderDetails {
  customer: {
    name: string;
    email: string;
    address: {
      street: string;
      city: string;
      state: string;
      country: string;
      zip: string;
    }
  }
  items: {
    name: string;
    quantity: number;
    price: number;
    lineTotal: number;
  }[];
  amount: number;
}

export type OrderItem = OrderDetails["items"][number];

export class OrderDetailsFactory {
  public static create(): OrderDetails {
    const chance = new Chance();

    const items = Array.from({ length: chance.integer({ min: 1, max: 5 }) }, () => ({
      name: chance.company(),
      quantity: chance.integer({ min: 1, max: 10 }),
      price: chance.floating({ min: 1, max: 100, fixed: 2 }),
    })).map(item => ({ ...item, lineTotal: item.price * item.quantity }));

    const amount = items.reduce((sum, item) => sum + item.lineTotal, 0);

    return {
      customer: {
        name: chance.name(),
        email: chance.email(),
        address: {
          street: chance.address(),
          city: chance.city(),
          state: chance.state(),
          country: chance.country(),
          zip: chance.zip(),
        }
      },
      items,
      amount
    } 
  }
}
