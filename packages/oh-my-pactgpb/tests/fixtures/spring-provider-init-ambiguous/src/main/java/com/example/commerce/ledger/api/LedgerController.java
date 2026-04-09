package com.example.commerce.ledger.api;

import com.example.commerce.ledger.dto.LedgerEntryResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/ledger/entries")
public class LedgerController {

  @GetMapping("/{id}")
  public LedgerEntryResponse getEntry(@PathVariable String id) {
    return new LedgerEntryResponse(id, "CLEARED");
  }
}
