package com.example.invoices.api;

import com.example.invoices.dto.InvoiceResponse;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/invoices")
public class InvoiceController {

  @GetMapping("/{id}")
  public InvoiceResponse getInvoice(@PathVariable String id) {
    return new InvoiceResponse(id, "PAID");
  }

  @PostMapping
  public InvoiceResponse createInvoice() {
    return new InvoiceResponse("generated", "CREATED");
  }

  @DeleteMapping("/{id}")
  public void deleteInvoice(@PathVariable String id) {
  }
}
