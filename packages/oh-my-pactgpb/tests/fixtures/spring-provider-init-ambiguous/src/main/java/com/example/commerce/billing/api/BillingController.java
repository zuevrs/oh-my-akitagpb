package com.example.commerce.billing.api;

import com.example.commerce.billing.dto.InvoiceResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/billing/invoices")
public class BillingController {

  @GetMapping("/{id}")
  public InvoiceResponse getInvoice(@PathVariable String id) {
    return new InvoiceResponse(id, "PAID");
  }
}
