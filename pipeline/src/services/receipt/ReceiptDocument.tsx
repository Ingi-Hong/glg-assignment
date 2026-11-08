import React from "react";
import { Page, View, Text, StyleSheet, Document } from "@react-pdf/renderer";

import { Order } from "../../definitions/entities/Order";

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
  header: {
    fontSize: 24,
    marginBottom: 20,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 10,
  },
  orderInfo: {
    marginBottom: 15,
  },
  customerInfo: {
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
    paddingBottom: 5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
    paddingVertical: 5,
  },
  itemName: {
    width: '40%',
  },
  itemQuantity: {
    width: '15%',
    textAlign: 'center',
  },
  itemPrice: {
    width: '20%',
    textAlign: 'right',
  },
  itemLineTotal: {
    width: '25%',
    textAlign: 'right',
  },
  total: {
    marginTop: 15,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  totalLabel: {
    fontWeight: 'bold',
    marginRight: 5,
  },
});

export const ReceiptDocument: React.FC<{ order: Order }> = ({ order }) => {
  return (
    <Document>
      <Page style={styles.page}>
        {/* Header */}
        <Text style={styles.header}>Receipt</Text>

        {/* Order Information */}
        <View style={styles.orderInfo}>
          <Text>Order ID: {order.orderId}</Text>
          <Text>Reference ID: {order.referenceId}</Text>
          <Text>Date: {new Date(order.createdAt).toLocaleDateString()}</Text>
        </View>

        {/* Customer Information */}
        {order.details && (
          <View style={styles.customerInfo}>
            <Text>Customer Information:</Text>
            <Text>{order.details.customer.name}</Text>
            <Text>{order.details.customer.email}</Text>
            <Text>
              {`${order.details.customer.address.street}, ${order.details.customer.address.city}, ${order.details.customer.address.state}, ${order.details.customer.address.country} ${order.details.customer.address.zip}`}
            </Text>
          </View>
        )}

        {/* Items Table Header */}
        <View style={styles.tableHeader}>
          <Text style={styles.itemName}>Item</Text>
          <Text style={styles.itemQuantity}>Quantity</Text>
          <Text style={styles.itemPrice}>Unit Price</Text>
          <Text style={styles.itemLineTotal}>Line Total</Text>
        </View>

        {/* Items */}
        {order.details?.items.map((item, index) => (
          <View style={styles.tableRow} key={index}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemQuantity}>{item.quantity}</Text>
            <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
            <Text style={styles.itemLineTotal}>${item.lineTotal.toFixed(2)}</Text>
          </View>
        ))}

        {/* Total Amount */}
        <View style={styles.total}>
          <Text style={styles.totalLabel}>Total Amount:</Text>
          <Text>${order.details?.amount.toFixed(2)}</Text>
        </View>
      </Page>
    </Document>
  );
}

