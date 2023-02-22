use output::FunctionError;
use shopify_function::prelude::*;
use shopify_function::Result;

use graphql_client;
use serde::{Deserialize, Serialize};

generate_types!(
    query_path = "./input.graphql",
    schema_path = "./schema.graphql"
);

#[derive(Serialize, Deserialize, Default, PartialEq)]
struct Config {}

#[shopify_function]
fn function(input: input::ResponseData) -> Result<output::FunctionResult> {
    let mut errors = Vec::new();
    let error = FunctionError {
        localized_message:
            "There is an order maximum of $1,000 for customers without established order history"
                .to_owned(),
        target: "cart".to_owned(),
    };

    // Parse the decimal (serialized as a string) into a float.
    let order_subtotal: f32 = input.cart.cost.subtotal_amount.amount.parse().unwrap();

    // Orders with subtotals greater than $1,000 are available only to established customers.
    if order_subtotal > 1000.0 {
        if let Some(buyer_identity) = input.cart.buyer_identity {
            if let Some(customer) = buyer_identity.customer {
                // If the customer has ordered less than 5 times in the past,
                // then treat them as a new customer.
                if customer.number_of_orders < 5 as i64 {
                    errors.push(error);
                }
            } else {
                errors.push(error);
            }
        // If there's no customer data, then treat them as a new customer.
        } else {
            errors.push(error);
        }
    }

    Ok(output::FunctionResult { errors })
}

#[cfg(test)]
mod tests;
