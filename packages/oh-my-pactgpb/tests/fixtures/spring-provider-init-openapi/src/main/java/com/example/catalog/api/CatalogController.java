package com.example.catalog.api;

import com.example.catalog.dto.CatalogItemResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/catalog/items")
public class CatalogController {

  @GetMapping("/{id}")
  public CatalogItemResponse getItem(@PathVariable String id) {
    return new CatalogItemResponse(id, "akita plush");
  }
}
