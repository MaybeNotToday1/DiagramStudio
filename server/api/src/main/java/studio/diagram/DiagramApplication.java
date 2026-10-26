package studio.diagram;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class DiagramApplication {
    public static void main(String[] args) { SpringApplication.run(DiagramApplication.class, args); }
}
