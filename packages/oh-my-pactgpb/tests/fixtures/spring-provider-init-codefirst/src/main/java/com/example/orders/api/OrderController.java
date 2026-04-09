package com.example.orders.api;

import com.example.orders.dto.OrderResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
public class OrderController {

  @GetMapping("/{id}")
  public OrderResponse getOrder(@PathVariable String id) {
    return new OrderResponse(id, "CONFIRMED");
  }
}
