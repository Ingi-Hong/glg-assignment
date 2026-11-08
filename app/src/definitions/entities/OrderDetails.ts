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
