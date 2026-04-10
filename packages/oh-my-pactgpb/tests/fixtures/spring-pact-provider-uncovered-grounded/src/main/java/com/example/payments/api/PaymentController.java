package com.example.payments.api;

import com.example.payments.dto.PaymentResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/payments")
public class PaymentController {

  @GetMapping("/{id}")
  public PaymentResponse getPayment(@PathVariable String id) {
    return new PaymentResponse(id, "PAID");
  }

  @PostMapping
  public PaymentResponse createPayment() {
    return new PaymentResponse("generated", "CREATED");
  }
}
