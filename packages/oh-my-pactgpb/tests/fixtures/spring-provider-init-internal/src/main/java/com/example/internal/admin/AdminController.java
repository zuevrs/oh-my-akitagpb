package com.example.internal.admin;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/cache")
public class AdminController {

  @PostMapping("/flush")
  public void flush() {
  }
}
